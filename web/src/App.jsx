import { useMemo, useState } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Dashboard from './components/Dashboard';
import Footer from './components/Footer';
import { demoArtifact } from './lib/demoArtifact';
import { buildViewModel, validateArtifactShape } from './lib/viewModel';

function App() {
  const [artifact, setArtifact] = useState(demoArtifact);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [error, setError] = useState(null);

  const handleFileSelect = (file) => {
    setSelectedFileName(file.name);
    setError(null);

    // Read and parse entirely client-side — the file is never sent
    // anywhere. reader.readAsText + JSON.parse both run in-browser.
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch {
        setError('That file is not valid JSON.');
        return;
      }
      const shapeError = validateArtifactShape(parsed);
      if (shapeError) {
        setError(shapeError);
        return;
      }
      setArtifact(parsed);
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const view = useMemo(() => buildViewModel(artifact), [artifact]);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Header onFileSelect={handleFileSelect} />
      <main>
        <Hero selectedFileName={selectedFileName} onFileSelect={handleFileSelect} view={view} />
        <Dashboard view={view} error={error} />
      </main>
      <Footer />
    </div>
  );
}

export default App;
