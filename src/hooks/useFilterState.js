import { useState, useCallback, useMemo, useEffect, useRef } from 'react'

// URL param keys
const P = { q: 'q', provider: 'provider', outcome: 'outcome', orbit: 'orbit', site: 'site', ymin: 'ymin', ymax: 'ymax', sort: 'sort', dir: 'dir', page: 'page' }

function parseURL() {
  const p = new URLSearchParams(window.location.search)
  return {
    search:    p.get(P.q) || '',
    providers: p.get(P.provider) ? p.get(P.provider).split(',').filter(Boolean) : [],
    outcomes:  p.get(P.outcome) ? p.get(P.outcome).split(',').filter(Boolean) : [],
    orbit_type:  p.get(P.orbit) || '',
    launch_site: p.get(P.site) || '',
    year_min:  p.has(P.ymin) ? Number(p.get(P.ymin)) : null,
    year_max:  p.has(P.ymax) ? Number(p.get(P.ymax)) : null,
    sort_by:   p.get(P.sort) || 'date',
    sort_dir:  p.get(P.dir) || 'desc',
    page:      p.has(P.page) ? Number(p.get(P.page)) : 0,
  }
}

function writeURL(state) {
  const p = new URLSearchParams()
  if (state.search)              p.set(P.q, state.search)
  if (state.providers.length)    p.set(P.provider, state.providers.join(','))
  if (state.outcomes.length)     p.set(P.outcome, state.outcomes.join(','))
  if (state.orbit_type)          p.set(P.orbit, state.orbit_type)
  if (state.launch_site)         p.set(P.site, state.launch_site)
  if (state.year_min != null)    p.set(P.ymin, state.year_min)
  if (state.year_max != null)    p.set(P.ymax, state.year_max)
  if (state.sort_by !== 'date')  p.set(P.sort, state.sort_by)
  if (state.sort_dir !== 'desc') p.set(P.dir, state.sort_dir)
  if (state.page > 0)           p.set(P.page, state.page)
  const qs = p.toString()
  const url = window.location.pathname + (qs ? '?' + qs : '')
  window.history.replaceState(null, '', url)
}

export default function useFilterState() {
  const [state, setState] = useState(parseURL)
  const isFirst = useRef(true)

  // Sync state → URL (skip first render to avoid overwriting initial URL)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return }
    writeURL(state)
  }, [state])

  const setSearch = useCallback((v) => setState(s => ({ ...s, search: v })), [])

  const toggleProvider = useCallback((p) => setState(s => {
    const arr = s.providers.includes(p) ? s.providers.filter(x => x !== p) : [...s.providers, p]
    return { ...s, providers: arr }
  }), [])

  const toggleOutcome = useCallback((o) => setState(s => {
    const arr = s.outcomes.includes(o) ? s.outcomes.filter(x => x !== o) : [...s.outcomes, o]
    return { ...s, outcomes: arr }
  }), [])

  const setOrbitType = useCallback((v) => setState(s => ({ ...s, orbit_type: v })), [])
  const setLaunchSite = useCallback((v) => setState(s => ({ ...s, launch_site: v })), [])
  const setYearRange = useCallback((min, max) => setState(s => ({ ...s, year_min: min, year_max: max })), [])
  const setSort = useCallback((by, dir) => setState(s => ({ ...s, sort_by: by, sort_dir: dir })), [])
  const setPage = useCallback((p) => setState(s => ({ ...s, page: typeof p === 'function' ? p(s.page) : p })), [])

  const clearAll = useCallback(() => setState(s => ({
    search: '', providers: [], outcomes: [], orbit_type: '', launch_site: '',
    year_min: null, year_max: null, sort_by: s.sort_by, sort_dir: s.sort_dir, page: 0,
  })), [])

  const hasActiveFilters = useMemo(() => (
    state.search || state.providers.length || state.outcomes.length ||
    state.orbit_type || state.launch_site || state.year_min != null || state.year_max != null
  ), [state])

  const activeFiltersList = useMemo(() => {
    const list = []
    if (state.search) list.push({ type: 'search', label: `"${state.search}"`, key: 'search' })
    state.providers.forEach(p => list.push({ type: 'provider', label: p, key: `p:${p}` }))
    state.outcomes.forEach(o => list.push({ type: 'outcome', label: o, key: `o:${o}` }))
    if (state.orbit_type) list.push({ type: 'orbit', label: state.orbit_type, key: 'orbit' })
    if (state.launch_site) list.push({ type: 'site', label: state.launch_site, key: 'site' })
    if (state.year_min != null || state.year_max != null)
      list.push({ type: 'years', label: `${state.year_min || '...'}\u2013${state.year_max || '...'}`, key: 'years' })
    return list
  }, [state])

  const removeFilter = useCallback((key) => {
    if (key === 'search') return setSearch('')
    if (key === 'orbit') return setOrbitType('')
    if (key === 'site') return setLaunchSite('')
    if (key === 'years') return setYearRange(null, null)
    if (key.startsWith('p:')) return toggleProvider(key.slice(2))
    if (key.startsWith('o:')) return toggleOutcome(key.slice(2))
  }, [setSearch, setOrbitType, setLaunchSite, setYearRange, toggleProvider, toggleOutcome])

  return {
    ...state,
    setSearch, toggleProvider, toggleOutcome, setOrbitType, setLaunchSite,
    setYearRange, setSort, setPage, clearAll, hasActiveFilters, activeFiltersList, removeFilter,
  }
}
