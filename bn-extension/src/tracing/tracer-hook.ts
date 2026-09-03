/**
 * Zero-dependency tracing seam.
 *
 * Analysis code (analysis/engine.ts, ai/*) traces through this module only. The real
 * implementation is registered by the background service worker
 * (tracing/aiqa-tracer.ts, which pulls in OpenTelemetry and aiqa-client); until then
 * every call here is a no-op. Two reasons for the indirection:
 * - bn-server consumes these modules via its bn-extension-src symlink and must not
 *   need the OpenTelemetry dependency.
 * - OpenTelemetry stays out of the content-script and offscreen bundles.
 */

export type TraceAttributes = Record<string, string | number | boolean>;

/**
 * A span timed somewhere the tracer cannot reach — the content script, or the
 * inference worker — carried back as data and replayed as a real span. Epoch ms.
 */
export interface TraceStep {
	name: string;
	start: number;
	end: number;
	attributes?: TraceAttributes;
	children?: TraceStep[];
}

/** Opaque span reference. Real shape is set by the registered implementation. */
export interface TraceHandle {
	readonly span: object;
}

export interface SpanOptions {
	/** Null or absent starts a new trace. */
	parent?: TraceHandle | null;
	attributes?: TraceAttributes;
	/**
	 * Epoch ms. Use when the work began before the span was created, so the span
	 * covers it — e.g. chunking timed in the content script.
	 */
	startTime?: number;
}

/** Returns null when tracing is off, so callers can pass handles around unguarded. */
export interface TracerImpl {
	startSpan(name: string, opts: SpanOptions): TraceHandle | null;
	endSpan(handle: TraceHandle, error?: unknown): void;
	setAttributes(handle: TraceHandle, attributes: TraceAttributes): void;
	recordSteps(steps: TraceStep[], parent: TraceHandle): void;
}

let impl: TracerImpl | null = null;

/** Pass null to disable tracing. See tracing/aiqa-tracer.ts. */
export function setTracerImpl(next: TracerImpl | null): void {
	impl = next;
}

export function isTracing(): boolean {
	return impl !== null;
}

export function startSpan(name: string, opts: SpanOptions = {}): TraceHandle | null {
	return impl ? impl.startSpan(name, opts) : null;
}

export function endSpan(
	handle: TraceHandle | null,
	attributes: TraceAttributes = {},
	error?: unknown
): void {
	if (!impl || !handle) return;
	impl.setAttributes(handle, attributes);
	impl.endSpan(handle, error);
}

export function setAttributes(handle: TraceHandle | null, attributes: TraceAttributes): void {
	if (impl && handle) impl.setAttributes(handle, attributes);
}

/**
 * Replay steps timed elsewhere as child spans of `parent`, keeping their original
 * times — e.g. model load and inference measured inside the offscreen worker.
 */
export function recordSteps(steps: TraceStep[] | undefined, parent: TraceHandle | null): void {
	if (impl && parent && steps?.length) impl.recordSteps(steps, parent);
}

/**
 * Trace one async call. With no implementation registered this costs only the
 * callback, so call sites need no enabled-check of their own.
 */
export async function traceStep<T>(
	name: string,
	opts: SpanOptions,
	fn: (handle: TraceHandle | null) => Promise<T>
): Promise<T> {
	const handle = startSpan(name, opts);
	if (!handle) return fn(null);
	try {
		const result = await fn(handle);
		endSpan(handle);
		return result;
	} catch (error) {
		endSpan(handle, {}, error);
		throw error;
	}
}
