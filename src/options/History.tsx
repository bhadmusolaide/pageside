import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { HistoryAnswer } from '../lib/history';
import { getUiLocale, subscribeLocale, t } from '../lib/i18n';

const PAGE_SIZE = 20;

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pageside-history-${new Date().toISOString().substring(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function History() {
  useSyncExternalStore(subscribeLocale, getUiLocale, getUiLocale);
  const [items, setItems] = useState<HistoryAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_history' });
      if (response?.type === 'history_items') {
        setItems(response.items ?? []);
      } else {
        setItems([]);
      }
    } catch (e) {
      setError(t('history.loadError', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleExport() {
    setExporting(true);
    setNotice(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'export_history_csv' });
      if (response?.type === 'history_csv' && response.count > 0) {
        downloadCsv(response.csv);
        setNotice({ kind: 'success', message: t('history.exportedAnswers', { count: response.count }) });
      } else {
        setNotice({ kind: 'error', message: t('history.noExportData') });
      }
    } catch (e) {
      setNotice({ kind: 'error', message: t('history.exportError', { error: (e as Error).message }) });
    } finally {
      setExporting(false);
    }
  }

  async function handleCopy(item: HistoryAnswer) {
    try {
      await navigator.clipboard.writeText(item.answer);
      setCopiedId(item.id ?? null);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setNotice({ kind: 'error', message: t('history.copyError') });
    }
  }

  async function handleDelete(id: number) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'delete_history_answer', id });
      if (response?.type === 'history_deleted' && response.deleted) {
        setItems(prev => prev.filter(item => item.id !== id));
        setNotice({ kind: 'success', message: t('history.deleted') });
      } else {
        setNotice({ kind: 'error', message: t('history.deleteError') });
      }
    } catch (e) {
      setNotice({ kind: 'error', message: t('history.deleteFailed', { error: (e as Error).message }) });
    } finally {
      setConfirmDelete(null);
    }
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setSearch('');
    setCompany('');
    setFromDate('');
    setToDate('');
    setPage(1);
  }

  const companies = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.company?.trim()) values.add(item.company.trim());
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return items.filter(item => {
      if (company && (item.company ?? '') !== company) return false;
      if (from !== null && item.createdAt < from) return false;
      if (to !== null && item.createdAt > to) return false;
      if (!query) return true;
      return item.question.toLowerCase().includes(query) ||
        item.answer.toLowerCase().includes(query) ||
        (item.company ?? '').toLowerCase().includes(query);
    });
  }, [items, search, company, fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(search || company || fromDate || toDate);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="flex-1 min-w-48 border border-gray-400 rounded px-3 py-2 text-sm"
          placeholder={t('history.search')}
          aria-label={t('history.search')}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <button className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50" onClick={() => void load()}>
          {t('history.refresh')}
        </button>
        <button
          className={`px-3 py-2 text-sm rounded text-white ${exporting ? 'bg-green-400' : 'bg-green-600 hover:bg-green-700'}`}
          disabled={exporting || items.length === 0}
          onClick={() => void handleExport()}
        >
          {exporting ? t('history.exporting') : t('history.exportCsv')}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 rounded border border-gray-200 bg-white px-3 py-2">
        <div>
          <label htmlFor="sr-history-company" className="block text-xs font-medium text-gray-700 mb-1">{t('history.company')}</label>
          <select
            id="sr-history-company"
            className="border border-gray-400 rounded px-2 py-1.5 text-sm min-w-40"
            value={company}
            onChange={e => { setCompany(e.target.value); setPage(1); }}
          >
            <option value="">{t('history.allCompanies')}</option>
            {companies.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sr-history-from" className="block text-xs font-medium text-gray-700 mb-1">{t('history.from')}</label>
          <input
            id="sr-history-from"
            type="date"
            className="border border-gray-400 rounded px-2 py-1.5 text-sm"
            value={fromDate}
            onChange={e => { setFromDate(e.target.value); setPage(1); }}
          />
        </div>
        <div>
          <label htmlFor="sr-history-to" className="block text-xs font-medium text-gray-700 mb-1">{t('history.to')}</label>
          <input
            id="sr-history-to"
            type="date"
            className="border border-gray-400 rounded px-2 py-1.5 text-sm"
            value={toDate}
            onChange={e => { setToDate(e.target.value); setPage(1); }}
          />
        </div>
        {hasFilters && (
          <button className="px-3 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200" onClick={clearFilters}>
            {t('history.clearFilters')}
          </button>
        )}
      </div>

      <p className="text-xs text-gray-600 mb-3">
        {t(filtered.length === 1 ? 'history.savedCountSingle' : 'history.savedCountPlural', {
          filtered: filtered.length,
          total: items.length,
        })} {t('history.exportDetails')}
      </p>

      {notice && (
        <div
          className={`mb-4 rounded border px-4 py-3 text-sm ${notice.kind === 'success' ? 'border-green-400 bg-green-100 text-green-800' : 'border-red-400 bg-red-100 text-red-800'}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.message}
        </div>
      )}

      {loading && <div className="text-center text-gray-600 py-8">{t('history.loading')}</div>}
      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center text-gray-600 py-8">
          <p className="text-lg mb-2">{t(items.length === 0 ? 'history.noAnswers' : 'history.noMatches')}</p>
          <p className="text-sm">
            {t(items.length === 0 ? 'history.autoSaveHelp' : 'history.filterHelp')}
          </p>
        </div>
      )}

      {!loading && !error && pageItems.length > 0 && (
        <div className="space-y-2">
          {pageItems.map(item => {
            const id = item.id ?? 0;
            const isExpanded = expanded.has(id);
            return (
              <div key={id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-900">{item.question}</p>
                  <span className="shrink-0 text-xs text-gray-600">
                    {new Date(item.createdAt).toLocaleDateString(getUiLocale())}
                  </span>
                </div>
                {item.company && <p className="text-xs text-gray-600 mb-1">{item.company}</p>}
                <p className={`text-xs text-gray-700 whitespace-pre-wrap leading-relaxed ${isExpanded ? '' : 'max-h-40 overflow-y-auto'}`}>
                  {item.answer}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                    onClick={() => toggleExpanded(id)}
                  >
                    {t(isExpanded ? 'history.collapse' : 'history.showFullAnswer')}
                  </button>
                  <button
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                    onClick={() => void handleCopy(item)}
                  >
                    {t(copiedId === id ? 'history.copied' : 'history.copy')}
                  </button>
                  {confirmDelete === id ? (
                    <>
                      <span className="text-xs text-red-800">{t('history.deleteQuestion')}</span>
                      <button
                        className="text-xs px-2.5 py-1.5 rounded bg-red-600 text-white hover:bg-red-700"
                        onClick={() => void handleDelete(id)}
                      >
                        {t('history.confirmDelete')}
                      </button>
                      <button
                        className="text-xs px-2.5 py-1.5 rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-100"
                        onClick={() => setConfirmDelete(null)}
                      >
                        {t('history.cancel')}
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-xs px-2.5 py-1.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                      onClick={() => setConfirmDelete(id)}
                    >
                      {t('history.delete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('history.previous')}
          </button>
          <span className="text-xs text-gray-600">{t('history.page', { page: currentPage, total: pageCount })}</span>
          <button
            className="px-3 py-2 text-sm rounded bg-white border border-gray-400 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('history.next')}
          </button>
        </div>
      )}
    </div>
  );
}

export default History;
