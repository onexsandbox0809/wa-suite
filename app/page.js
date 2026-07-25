import Link from 'next/link';

export default function Home() {
  return (
    <div className="container">
      <div className="card">
        <h1 className="title">WA Suite</h1>
        <p className="subtitle">One deployment, one database:</p>
        <ul>
          <li>
            <a href="/campaign/index.html">New Campaign</a> — create WhatsApp campaigns
          </li>
          <li>
            <a href="/campaign/campaigns.html">All Campaigns</a> — browse past campaigns
          </li>
          <li>
            <a href="/campaign/clicks.html">Clicker Data</a> — click reporting: summary
            by campaign button, drill-down by recipient, and CSV/Excel export
          </li>
        </ul>
        <p className="subtitle">
          Create short links via <code>POST /api/create</code>.
        </p>
      </div>
    </div>
  );
}
