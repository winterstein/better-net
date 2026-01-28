import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardBody, CardHeader, Table, Badge } from 'reactstrap';
import { api, Page, Chunk } from '../services/api';

function PageDetail() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState<Page | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadPage();
      loadChunks();
    }
  }, [id]);

  const loadPage = async () => {
    if (!id) return;
    try {
      const data = await api.getPage(id);
      setPage(data);
    } catch (error) {
      console.error('Failed to load page:', error);
    }
  };

  const loadChunks = async () => {
    if (!id) return;
    try {
      // Search for chunks that belong to this page
      // Assuming chunks have a pageId or url field
      const allChunks = await api.getChunks();
      // Filter chunks by page URL or pageId if available
      const pageChunks = allChunks.filter(
        (chunk) => chunk.url === page?.url || (chunk as any).pageId === id
      );
      setChunks(pageChunks);
    } catch (error) {
      console.error('Failed to load chunks:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading page...</div>;
  }

  if (!page) {
    return <div>Page not found</div>;
  }

  return (
    <div>
      <Link to="/pages">← Back to Pages</Link>
      <Card className="mt-3">
        <CardHeader>
          <h3>Page Details</h3>
        </CardHeader>
        <CardBody>
          <Table borderless>
            <tbody>
              <tr>
                <th>ID:</th>
                <td>{page.id}</td>
              </tr>
              <tr>
                <th>URL:</th>
                <td>{page.url || '-'}</td>
              </tr>
              <tr>
                <th>Title:</th>
                <td>{page.title || '-'}</td>
              </tr>
              <tr>
                <th>Domain:</th>
                <td>{page.domain || '-'}</td>
              </tr>
              <tr>
                <th>Created:</th>
                <td>{new Date(page.createdAt).toLocaleString()}</td>
              </tr>
              <tr>
                <th>Updated:</th>
                <td>{new Date(page.updatedAt).toLocaleString()}</td>
              </tr>
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card className="mt-3">
        <CardHeader>
          <h4>Chunks ({chunks.length})</h4>
        </CardHeader>
        <CardBody>
          {chunks.length === 0 ? (
            <p>No chunks found for this page</p>
          ) : (
            <Table striped>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Text Preview</th>
                  <th>Has Analysis</th>
                </tr>
              </thead>
              <tbody>
                {chunks.map((chunk) => (
                  <tr key={chunk.id}>
                    <td>
                      <Link to={`/chunks/${chunk.id}`}>{chunk.id}</Link>
                    </td>
                    <td>
                      {chunk.text
                        ? chunk.text.substring(0, 100) + (chunk.text.length > 100 ? '...' : '')
                        : '-'}
                    </td>
                    <td>
                      {chunk.analysis ? (
                        <Badge color="success">Yes</Badge>
                      ) : (
                        <Badge color="secondary">No</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default PageDetail;

