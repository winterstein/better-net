import React, { useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import {
  Navbar,
  NavbarBrand,
  NavbarToggler,
  Collapse,
  Nav,
  NavItem,
  Container,
} from 'reactstrap';
import PagesList from './pages/PagesList';
import PageDetail from './pages/PageDetail';
import AnalyzeUrl from './pages/AnalyzeUrl';
import ChunksList from './chunks/ChunksList';
import ChunkDetail from './chunks/ChunkDetail';

function App() {
  const [navOpen, setNavOpen] = useState(false);
  const toggleNav = () => setNavOpen((open) => !open);

  return (
    <div>
      <Navbar color="light" light expand="md">
        <Container>
          <NavbarBrand tag={Link} to="/pages">
            better:net
          </NavbarBrand>
          <NavbarToggler onClick={toggleNav} aria-expanded={navOpen} />
          <Collapse isOpen={navOpen} navbar>
            <Nav navbar>
              <NavItem>
                <Link to="/pages" className="nav-link" onClick={() => setNavOpen(false)}>
                  Pages
                </Link>
              </NavItem>
              <NavItem>
                <Link
                  to="/pages/analyze"
                  className="nav-link"
                  onClick={() => setNavOpen(false)}
                >
                  Analyze URL
                </Link>
              </NavItem>
              <NavItem>
                <Link to="/chunks" className="nav-link" onClick={() => setNavOpen(false)}>
                  Chunks
                </Link>
              </NavItem>
            </Nav>
          </Collapse>
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

