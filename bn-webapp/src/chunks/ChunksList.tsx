import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, Input, Container, Row, Col, Button, Badge } from 'reactstrap';
import { api, Chunk } from '../services/api';

function ChunksList() {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadChunks();
  }, []);

  const loadChunks = async (query?: string) => {
    try {
      setLoading(true);
      const data = await api.getChunks(query);
      setChunks(data);
    } catch (error) {
      console.error('Failed to load chunks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadChunks(searchQuery || undefined);
  };

  if (loading) {
    return <div>Loading chunks...</div>;
  }

  return (
    <div>
      <Row className="mb-3">
        <Col>
          <h2>Chunks</h2>
        </Col>
        <Col md="6">
          <form onSubmit={handleSearch}>
            <Row>
              <Col>
                <Input
                  type="text"
                  placeholder="Search chunks (Gmail-style query)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </Col>
              <Col xs="auto">
                <Button type="submit" color="primary">Search</Button>
              </Col>
              {searchQuery && (
                <Col xs="auto">
                  <Button
                    type="button"
                    color="secondary"
                    onClick={() => {
                      setSearchQuery('');
                      loadChunks();
                    }}
                  >
                    Clear
                  </Button>
                </Col>
              )}
            </Row>
          </form>
        </Col>
      </Row>
      <Table striped>
        <thead>
          <tr>
            <th>ID</th>
            <th>URL</th>
            <th>Title</th>
            <th>Text Preview</th>
            <th>Has Analysis</th>
          </tr>
        </thead>
        <tbody>
          {chunks.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center">
                No chunks found
              </td>
            </tr>
          ) : (
            chunks.map((chunk) => (
              <tr key={chunk.id}>
                <td>
                  <Link to={`/chunks/${chunk.id}`}>{chunk.id}</Link>
                </td>
                <td>{chunk.url || '-'}</td>
                <td>{chunk.title || '-'}</td>
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
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

export default ChunksList;

