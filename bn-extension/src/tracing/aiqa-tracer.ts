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
import { SpanStatusCode, trace, context as otelContext, TraceFlags } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { setTracerImpl } from './tracer-hook.js';
import type {
	SpanOptions,
	TraceAttributes,
	TraceHandle,
	TracerImpl,
	TraceStep,
} from './tracer-hook.js';
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

/**
 * A step timed outside the service worker — content-script chunking, or model load and
 * inference inside the offscreen worker — replayed as a span.
 */
export type RelayedStep = TraceStep;

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

	recordSteps(steps, parent) {
		recordRelayedSteps(steps, parent);
	},

	ids(handle) {
		const ctx = asSpan(handle).spanContext();
		// An unsampled span carries the all-zero context, which is no use as a link.
		if (!ctx?.traceId || /^0+$/.test(ctx.traceId)) return null;
		return { traceId: ctx.traceId, spanId: ctx.spanId };
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

/** 16 hex chars: the OTel span-id format, for a feedback span with no known parent. */
function randomSpanId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mirror user feedback onto the trace it is about, so a thumb shows up beside the
 * prompts in the AIQA UI. Same span shape as aiqa-client's own submitFeedback(), which
 * we cannot call: it drives the provider initTracing() built, and we drive our own.
 *
 * bn-server holds the record of feedback (specs/feedback.md); this is a copy for the
 * trace view, so it never throws and never blocks the UI.
 */
export async function mirrorFeedbackToAiqa(
	traceId: string,
	feedback: { thumbsUp?: boolean; comment?: string; parentSpanId?: string }
): Promise<boolean> {
	if (!provider || !/^[0-9a-f]{32}$/.test(traceId)) return false;
	try {
		const parentSpanId = /^[0-9a-f]{16}$/.test(feedback.parentSpanId ?? '')
			? feedback.parentSpanId!
			: randomSpanId();
		const parent = trace.setSpanContext(otelContext.active(), {
			traceId,
			spanId: parentSpanId,
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		});
		const attributes: TraceAttributes = {
			'feedback.value':
				feedback.thumbsUp === undefined ? 'neutral' : feedback.thumbsUp ? 'positive' : 'negative',
			'gen_ai.operation.name': 'feedback',
		};
		if (feedback.comment) attributes['feedback.comment'] = feedback.comment;
		tracer().startSpan('feedback', { attributes: spanAttributes(attributes) }, parent).end();
		await flushAiqaSpans();
		return true;
	} catch (error) {
		logit('warn', '[BetterNet] [AIQA] Feedback mirror failed:', (error as Error)?.message);
		return false;
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
