import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, CardHeader, Form, FormGroup, Label, Input, Button, Alert } from 'reactstrap';
import { api } from '../services/api';

function AnalyzeUrl() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const page = await api.createPage({ url: url.trim() });
      navigate(`/pages/${page.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create page');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card>
        <CardHeader>
          <h3>Analyze URL</h3>
        </CardHeader>
        <CardBody>
          {error && <Alert color="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <FormGroup>
              <Label for="url">URL</Label>
              <Input
                type="url"
                id="url"
                placeholder="https://example.com/article"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
            </FormGroup>
            <Button color="primary" type="submit" disabled={loading}>
              {loading ? 'Analyzing...' : 'Analyze URL'}
            </Button>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}

export default AnalyzeUrl;

