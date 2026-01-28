import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, Input, Container, Row, Col } from 'reactstrap';
import { api, Page } from '../services/api';

function PagesList() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadPages();
  }, []);

  const loadPages = async () => {
    try {
      setLoading(true);
      const data = await api.getPages();
      setPages(data);
    } catch (error) {
      console.error('Failed to load pages:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredPages = pages.filter(page => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      page.url?.toLowerCase().includes(term) ||
      page.title?.toLowerCase().includes(term) ||
      page.domain?.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return <div>Loading pages...</div>;
  }

  return (
    <div>
      <Row className="mb-3">
        <Col>
          <h2>Pages</h2>
        </Col>
        <Col md="6">
          <Input
            type="text"
            placeholder="Search pages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </Col>
      </Row>
      <Table striped>
        <thead>
          <tr>
            <th>ID</th>
            <th>URL</th>
            <th>Title</th>
            <th>Domain</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {filteredPages.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center">
                No pages found
              </td>
            </tr>
          ) : (
            filteredPages.map((page) => (
              <tr key={page.id}>
                <td>
                  <Link to={`/pages/${page.id}`}>{page.id}</Link>
                </td>
                <td>{page.url || '-'}</td>
                <td>{page.title || '-'}</td>
                <td>{page.domain || '-'}</td>
                <td>{new Date(page.createdAt).toLocaleDateString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

export default PagesList;

