import MiniPreview from './MiniPreview';

function Hero({ selectedFileName, onFileSelect, view }) {
  const handleChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onFileSelect(file);
    event.target.value = '';
  };

  return (
    <section id="overview" className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
        <div>
          <h1 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-4xl">
            Turn engineering evidence into auditable impact.
          </h1>

          <p className="mt-4 max-w-lg text-base leading-7 text-gray-600">
            ImpactCompiler turns commits, benchmarks, and production metrics into deterministic, evidence-backed impact claims. This is its read-only review layer — open an impact.json artifact and see exactly what was measured and why it's trustworthy.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#evidence"
              className="inline-flex items-center justify-center rounded-md bg-gray-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              Explore demo artifact
            </a>

            <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:border-gray-400 hover:bg-gray-50">
              Open your own impact.json
              <input type="file" accept=".json,application/json" onChange={handleChange} className="sr-only" />
            </label>
          </div>

          <p className="mt-5 text-xs leading-5 text-gray-500">
            Processed locally in your browser — nothing is uploaded, logged, or sent to a server.
            {selectedFileName && (
              <span className="mt-1 block font-medium text-gray-900">Loaded file: {selectedFileName}</span>
            )}
          </p>
        </div>

        <MiniPreview view={view} />
      </div>
    </section>
  );
}

export default Hero;
