/**
 * Dependency-free step timer for the content script.
 *
 * Chunking runs in the content script (it needs the DOM) but only the background
 * service worker may talk to the AIQA server, and content scripts are injected into
 * every page — so we keep OpenTelemetry out of this bundle. Steps recorded here are
 * shipped with the ANALYZE_CHUNKS message and replayed as real spans by
 * tracing/aiqa-tracer.ts (recordRelayedSteps).
 */

import type { TraceAttributes } from './tracer-hook.js';

export type StepAttributes = TraceAttributes;

/** Wire form of RelayedStep in aiqa-tracer.ts. */
export interface TraceStep {
	name: string;
	/** Epoch ms. */
	start: number;
	end: number;
	attributes?: StepAttributes;
	children?: TraceStep[];
}

/**
 * Records timed steps into a tree. Disabled recorders (tracing off) do nothing but
 * run the callback, so call sites never need an enabled-check.
 */
export class StepRecorder {
	/** null when disabled. */
	private readonly into: TraceStep[] | null;
	/** The step this recorder is inside, for annotate(). Undefined at the root. */
	private readonly current?: TraceStep;

	constructor(into: TraceStep[] | null, current?: TraceStep) {
		this.into = into;
		this.current = current;
	}

	/** Time `fn`. Steps recorded on the recorder it receives nest under this one. */
	async step<T>(
		name: string,
		attributes: StepAttributes,
		fn: (recorder: StepRecorder) => T | Promise<T>
	): Promise<T> {
		if (!this.into) return fn(this);
		const record: TraceStep = {
			name,
			start: Date.now(),
			end: 0,
			attributes: { ...attributes },
			children: [],
		};
		this.into.push(record);
		try {
			return await fn(new StepRecorder(record.children!, record));
		} finally {
			record.end = Date.now();
		}
	}

	/** Merge attributes onto the step in progress, once its result is known. */
	annotate(attributes: StepAttributes): void {
		if (this.current) Object.assign(this.current.attributes!, attributes);
	}
}

/** Steps collected at the root of a recorder tree, ready to send to the background. */
export function createStepRecorder(enabled: boolean): { recorder: StepRecorder; steps: TraceStep[] } {
	const steps: TraceStep[] = [];
	return { recorder: new StepRecorder(enabled ? steps : null), steps };
}

export const NOOP_STEP_RECORDER = new StepRecorder(null);
