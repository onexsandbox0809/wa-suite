'use client';

import { useEffect } from 'react';

// Click reporting now lives exclusively in the campaign manager's
// "Clicker Data" page. This route is kept only so old bookmarks/links
// to /dashboard don't dead-end -- it just forwards on.
export default function Dashboard() {
  useEffect(() => {
    window.location.replace('/campaign/clicks.html');
  }, []);

  return (
    <div className="container">
      <div className="card">
        <p className="subtitle">
          Redirecting to the <a href="/campaign/clicks.html">Clicker Data</a> page…
        </p>
      </div>
    </div>
  );
}
