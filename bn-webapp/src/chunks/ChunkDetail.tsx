import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Table, Button, Badge, Alert } from 'reactstrap';
import { api, Chunk } from '../services/api';

function ChunkDetail() {
  const { id } = useParams<{ id: string }>();
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadChunk();
    }
  }, [id]);

  const loadChunk = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await api.getChunk(id);
      setChunk(data);
      if (data.analysis) {
        setAnalysis(data.analysis);
      } else {
        // Try to fetch analysis separately
        try {
          const analysisData = await api.getChunkAnalysis(id);
          setAnalysis(analysisData);
        } catch {
          // Analysis doesn't exist yet
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chunk');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!id) return;
    try {
      setAnalyzing(true);
      setError(null);
      const result = await api.analyzeChunk(id);
      setAnalysis(result);
      // Reload chunk to get updated data
      await loadChunk();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze chunk');
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return <div>Loading chunk...</div>;
  }

  if (!chunk) {
    return <div>Chunk not found</div>;
  }

  return (
    <div>
      <Link to="/chunks">← Back to Chunks</Link>
      {error && <Alert color="danger" className="mt-3">{error}</Alert>}
      
      <Card className="mt-3">
        <CardHeader>
          <h3>Chunk Details</h3>
        </CardHeader>
        <CardBody>
          <Table borderless>
            <tbody>
              <tr>
                <th>ID:</th>
                <td>{chunk.id}</td>
              </tr>
              <tr>
                <th>URL:</th>
                <td>{chunk.url || '-'}</td>
              </tr>
              <tr>
                <th>Title:</th>
                <td>{chunk.title || '-'}</td>
              </tr>
              <tr>
                <th>Domain:</th>
                <td>{chunk.domain || '-'}</td>
              </tr>
              <tr>
                <th>Text:</th>
                <td>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto' }}>
                    {chunk.text || '-'}
                  </pre>
                </td>
              </tr>
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="mt-3">
        <CardHeader>
          <div className="d-flex justify-content-between align-items-center">
            <h4>Analysis</h4>
            {!analysis && (
              <Button color="primary" onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? 'Analyzing...' : 'Analyze Chunk'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {analysis ? (
            <div>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '500px', overflow: 'auto' }}>
                {JSON.stringify(analysis, null, 2)}
              </pre>
            </div>
          ) : (
            <div>
              <p>No analysis available. Click "Analyze Chunk" to perform analysis.</p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default ChunkDetail;

