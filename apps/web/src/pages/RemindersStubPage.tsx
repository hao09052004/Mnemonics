import { Icon } from '../components/dashboard/Icons';

export function RemindersStubPage() {
  return (
    <main className="main standard">
      <header className="page-header">
        <div>
          <span className="eyebrow">GENTLE PROMPTS</span>
          <h1>Reminders</h1>
          <p>A few things you asked to revisit.</p>
        </div>
      </header>
      <section className="empty" aria-label="Reminders stub">
        <div className="empty-inner">
          <div className="empty-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1>Coming soon</h1>
          <p>
            Mnemonics Reminders is on the roadmap. The API for this page
            is not in v1.
          </p>
        </div>
      </section>
      <span hidden>
        <Icon name="bell" />
      </span>
    </main>
  );
}