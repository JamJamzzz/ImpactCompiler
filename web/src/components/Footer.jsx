function Footer() {
  return (
    <footer className="w-full border-t border-gray-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-6 text-xs text-gray-500 sm:px-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-gray-950 text-[9px] font-bold text-white">
            IC
          </span>
          <span>ImpactCompiler — Deterministic metrics · Auditable claims · No invented numbers</span>
        </div>
        <p>Processed locally in your browser.</p>
      </div>
    </footer>
  );
}

export default Footer;
