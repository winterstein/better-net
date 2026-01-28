import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { Navbar, Nav, NavItem, Container } from 'reactstrap';
import PagesList from './pages/PagesList';
import PageDetail from './pages/PageDetail';
import AnalyzeUrl from './pages/AnalyzeUrl';
import ChunksList from './chunks/ChunksList';
import ChunkDetail from './chunks/ChunkDetail';

function App() {
  return (
    <div>
      <Navbar color="light" light expand="md">
        <Container>
          <Nav navbar>
            <NavItem>
              <Link to="/pages" className="nav-link">Pages</Link>
            </NavItem>
            <NavItem>
              <Link to="/pages/analyze" className="nav-link">Analyze URL</Link>
            </NavItem>
            <NavItem>
              <Link to="/chunks" className="nav-link">Chunks</Link>
            </NavItem>
          </Nav>
        </Container>
      </Navbar>
      <Container className="mt-4">
        <Routes>
          <Route path="/" element={<PagesList />} />
          <Route path="/pages" element={<PagesList />} />
          <Route path="/pages/analyze" element={<AnalyzeUrl />} />
          <Route path="/pages/:id" element={<PageDetail />} />
          <Route path="/chunks" element={<ChunksList />} />
          <Route path="/chunks/:id" element={<ChunkDetail />} />
        </Routes>
      </Container>
    </div>
  );
}

export default App;

