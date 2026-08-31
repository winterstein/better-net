/**
 * AIQA tracing implementation, for the background service worker only.
 *
 * `aiqa-client`'s entry point is Node-only (dotenv, plus async_hooks via
 * NodeTracerProvider), so we import its browser-safe `AIQASpanExporter` and drive it
 * with `@opentelemetry/sdk-trace-base`. Wire format and server contract are the
 * package's, so traces land in AIQA as they would from a Node service.
 *
 * Lifecycle: configureAiqaTracing() at the start of each page analysis (settings may
 * have changed), spans via tracing/tracer-hook.ts, then flushAiqaSpans() before the
 * analysis returns — an MV3 worker can be suspended at any time, so we never rely on
 * the exporter's own flush timer.
 *
 * Parents are always passed explicitly: no OTel context manager survives `await` in a
 * service worker, so context.active() is never trusted to hold the current span.
 */

import { AIQASpanExporter } from 'aiqa-client/dist/aiqa-exporter.js';
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SpanStatusCode, trace, context as otelContext } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { setTracerImpl } from './tracer-hook.js';
import type { SpanOptions, TraceAttributes, TraceHandle, TracerImpl } from './tracer-hook.js';
import { logit } from '../utils/logger.js';

/** aiqa-client's own default (see its README, AIQA_SERVER_URL). */
const DEFAULT_AIQA_SERVER_URL = 'https://server-aiqa.winterwell.com';
/** Tracer name aiqa-client uses, kept so spans group the same way in the AIQA UI. */
const TRACER_NAME = 'aiqa-tracer';
/** Default AIQA_COMPONENT_TAG, for filtering bn-extension traces in the Traces view. */
const DEFAULT_COMPONENT_TAG = 'betternet.bn-extension';

/** Settings keys read from chrome.storage.sync (see settings/defaults.ts). */
export interface AiqaSettings {
	aiqaTracing?: boolean;
	aiqaApiKey?: string;
	aiqaServerUrl?: string;
	/** 0-1, AIQA_SAMPLING_RATE. Every page view is a trace, so this is worth turning down. */
	aiqaSamplingRate?: number;
}

/** A step timed outside the service worker (content-script chunking), replayed as a span. */
export interface RelayedStep {
	name: string;
	/** Epoch ms. */
	start: number;
	end: number;
	attributes?: TraceAttributes;
	children?: RelayedStep[];
}

let provider: BasicTracerProvider | null = null;
let exporter: AIQASpanExporter | null = null;
/** Config the live provider was built from, so we only rebuild when it changes. */
let activeKey = '';


const asSpan = (handle: TraceHandle): Span => handle.span as Span;

/** Undefined = start a new trace root. */
function parentContext(parent: TraceHandle | null) {
	return parent ? trace.setSpan(otelContext.active(), asSpan(parent)) : undefined;
}

function spanAttributes(attributes: TraceAttributes): TraceAttributes {
	return { 'aiqa.component': DEFAULT_COMPONENT_TAG, ...attributes };
}

function tracer() {
	return provider!.getTracer(TRACER_NAME);
}

const aiqaTracerImpl: TracerImpl = {
	startSpan(name: string, opts: SpanOptions) {
		if (!provider) return null;
		const span = tracer().startSpan(
			name,
			{ attributes: spanAttributes(opts.attributes ?? {}), startTime: opts.startTime },
			parentContext(opts.parent ?? null)
		);
		return { span };
	},

	setAttributes(handle, attributes) {
		const span = asSpan(handle);
		for (const [key, value] of Object.entries(attributes)) {
			if (value !== undefined && value !== null) span.setAttribute(key, value);
		}
	},

	endSpan(handle, error) {
		const span = asSpan(handle);
		if (error !== undefined) {
			const message = error instanceof Error ? error.message : String(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message });
			if (error instanceof Error) span.recordException(error);
		}
		span.end();
	},
};

async function teardown(): Promise<void> {
	const old = provider;
	setTracerImpl(null);
	provider = null;
	exporter = null;
	activeKey = '';
	if (old) await old.shutdown().catch(() => {});
}

function configKey(s: AiqaSettings): string {
	return [s.aiqaServerUrl, s.aiqaApiKey, s.aiqaSamplingRate].join(' ');
}

/**
 * Enable or disable tracing to match settings. Safe to call on every page analysis.
 * Returns true when tracing is live.
 */
export async function configureAiqaTracing(settings: AiqaSettings): Promise<boolean> {
	try {
		return await applyTracingConfig(settings);
	} catch (error) {
		// Analysis must never fail because observability could not start.
		logit('warn', '[BetterNet] [AIQA] Could not enable tracing:', (error as Error)?.message);
		setTracerImpl(null);
		return false;
	}
}

async function applyTracingConfig(settings: AiqaSettings): Promise<boolean> {
	const apiKey = settings.aiqaApiKey?.trim();
	if (!settings.aiqaTracing || !apiKey) {
		if (provider) await teardown();
		return false;
	}

	const key = configKey(settings);
	if (provider && key === activeKey) return true;
	if (provider) await teardown();

	const serverUrl = settings.aiqaServerUrl?.trim() || DEFAULT_AIQA_SERVER_URL;
	const rate = settings.aiqaSamplingRate;
	const samplingRate = typeof rate === 'number' && rate >= 0 && rate <= 1 ? rate : 1;
	exporter = new AIQASpanExporter(serverUrl, apiKey);
	provider = new BasicTracerProvider({
		resource: new Resource({ 'service.name': 'bn-extension' }),
		sampler: new TraceIdRatioBasedSampler(samplingRate),
	});
	provider.addSpanProcessor(new BatchSpanProcessor(exporter));
	activeKey = key;
	setTracerImpl(aiqaTracerImpl);
	logit('log', '[BetterNet] [AIQA] Tracing enabled, server:', serverUrl);
	return true;
}

/**
 * Replay steps timed elsewhere (content-script chunking, see tracing/trace-steps.ts)
 * as spans under `parent`, preserving their original start and end times.
 */
export function recordRelayedSteps(steps: RelayedStep[] | undefined, parent: TraceHandle | null): void {
	if (!provider || !parent || !steps?.length) return;
	for (const step of steps) {
		if (!Number.isFinite(step.start) || !Number.isFinite(step.end)) continue;
		const span = tracer().startSpan(
			step.name,
			{ startTime: step.start, attributes: spanAttributes(step.attributes ?? {}) },
			parentContext(parent)
		);
		recordRelayedSteps(step.children, { span });
		span.end(step.end);
	}
}

/** Flush before the service worker can be suspended. Never throws. */
export async function flushAiqaSpans(): Promise<void> {
	try {
		await provider?.forceFlush();
		await exporter?.flush();
	} catch (error) {
		logit('warn', '[BetterNet] [AIQA] Flush failed:', (error as Error)?.message);
	}
}

/** Tests only: drop the provider so the next configure call rebuilds it. */
export async function resetAiqaTracingForTests(): Promise<void> {
	await teardown();
}
