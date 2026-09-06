function Header({ onFileSelect }) {
  const handleChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onFileSelect(file);
    event.target.value = '';
  };

  return (
    <header className="sticky top-0 z-10 w-full border-b border-gray-100 bg-white shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-5 py-4 sm:px-8">
        <a href="#overview" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-gray-950">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-950 text-xs font-bold text-white">
            IC
          </span>
          <span>ImpactCompiler</span>
        </a>

        <nav className="hidden items-center gap-7 text-sm text-gray-500 md:flex" aria-label="Primary navigation">
          <a className="transition-colors duration-200 hover:text-gray-950" href="#overview">Overview</a>
          <a className="transition-colors duration-200 hover:text-gray-950" href="#evidence">Evidence</a>
          <a className="transition-colors duration-200 hover:text-gray-950" href="#review">Review</a>
        </nav>

        <label className="inline-flex cursor-pointer items-center rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-800 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow">
          Open impact.json
          <input type="file" accept=".json,application/json" onChange={handleChange} className="sr-only" />
        </label>
      </div>
    </header>
  );
}

export default Header;
