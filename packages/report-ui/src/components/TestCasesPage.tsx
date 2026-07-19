import { useId, useMemo, useState } from 'react';
import { ListChecks, Search } from 'lucide-react';
import type { TestCaseReport } from '../types';
import { durationMs } from '../lib/format';
import { Detail } from './Detail';
import { Empty } from './Empty';

type TestCasesPageProps = {
  testCases: TestCaseReport[];
  selectedSlug?: string;
  tab: string;
  onTab: (tab: string) => void;
};

export function TestCasesPage({ testCases, selectedSlug, tab, onTab }: TestCasesPageProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const selected = selectedSlug ? testCases.find(test => test.slug === selectedSlug) : testCases[0];
  const filteredTests = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return testCases;
    return testCases.filter(test => test.testName.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, testCases]);

  return (
    <section className="test-cases-page" aria-label="Test cases">
      <div className="test-cases-workspace">
        <aside className="case-navigator" aria-label="Executed test cases">
          <div className="case-nav-head">
            <div>
              <ListChecks aria-hidden="true" />
              <strong>Executed tests</strong>
            </div>
            <span>{filteredTests.length} of {testCases.length}</span>
          </div>

          <label className="case-search" htmlFor={searchId}>
            <span className="sr-only">Search test cases</span>
            <Search aria-hidden="true" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search by test name"
              autoComplete="off"
              disabled={testCases.length === 0}
            />
          </label>

          <nav className="case-list" aria-label="Test case selection">
            {filteredTests.map(test => {
              const isPassed = test.status.toUpperCase() === 'PASSED';
              const isSelected = selected?.slug === test.slug;
              const elapsed = durationMs(test.durationMs ?? test.totalDurationMs);
              return (
                <a
                  key={test.slug}
                  className={`${isSelected ? 'selected ' : ''}${isPassed ? 'passed' : 'failed'}`}
                  href={`#test-cases?test=${encodeURIComponent(test.slug)}&tab=${encodeURIComponent(tab)}`}
                  aria-current={isSelected ? 'page' : undefined}
                  title={test.testName}
                >
                  <i aria-hidden="true" />
                  <span>
                    <strong>{test.testName}</strong>
                    <small>
                      {test.stepsExecuted} {test.stepsExecuted === 1 ? 'step' : 'steps'}
                      <b aria-hidden="true">·</b>
                      {elapsed}
                    </small>
                  </span>
                  <em>{isPassed ? 'Passed' : 'Failed'}</em>
                </a>
              );
            })}
            {testCases.length === 0 && <p className="case-list-empty">No test cases were executed in this report.</p>}
            {testCases.length > 0 && filteredTests.length === 0 && (
              <p className="case-list-empty">No tests match “{query.trim()}”.</p>
            )}
          </nav>
        </aside>

        <div className="case-detail" aria-live="polite">
          {selected ? (
            <Detail test={selected} tab={tab} onTab={onTab} showBack={false} />
          ) : (
            <Empty
              title={selectedSlug ? 'Test not found' : 'No test selected'}
              copy={selectedSlug ? 'The requested test does not exist in this report.' : 'Run a test to view its execution details.'}
            />
          )}
        </div>
      </div>
    </section>
  );
}
