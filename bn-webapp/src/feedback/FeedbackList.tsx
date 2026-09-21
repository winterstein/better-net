/** Shared rendering for a list of feedback rows. */

import { Table } from 'reactstrap';
import { describeFeedback } from './feedback-state';
import type { FeedbackRow } from '../services/api';

function when(created?: string): string {
	if (!created) return '';
	const date = new Date(created);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export function FeedbackList({ rows, showSubmitter }: { rows: FeedbackRow[]; showSubmitter?: boolean }) {
	return (
		<Table responsive hover size="sm">
			<thead>
				<tr>
					{showSubmitter && <th>Submitter</th>}
					<th>What was rated</th>
					<th>Correction</th>
					<th>Note</th>
					<th>When</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row, i) => (
					<tr key={row.localId || i}>
						{/* A pseudonym, never an email — the API does not send one. */}
						{showSubmitter && <td><code>{row.submitter || '—'}</code></td>}
						<td>
							<div>{row.chunkTitle || row.chunkUrl || '—'}</div>
							{row.moduleId && <small className="text-muted">{row.moduleId}</small>}
						</td>
						<td>{describeFeedback(row)}</td>
						<td>{row.message || ''}</td>
						<td><small>{when(row.created)}</small></td>
					</tr>
				))}
			</tbody>
		</Table>
	);
}
