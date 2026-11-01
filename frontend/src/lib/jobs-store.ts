import type { Job, RemoteFilter } from './api'
import { newId, useStored } from './store'

/** A job kept for later, or hidden from results. The whole listing is kept so it still shows after the search is gone. */
export interface StoredJob extends Job {
  /** When it was saved or dismissed. */
  at: string
}

export interface PastSearch {
  id: string
  q: string
  location: string
  remote: RemoteFilter
  excluded: string[]
  at: string
  /** Listings returned by the first page. */
  count: number
}

const MAX_JOBS = 300
const MAX_PAST = 20

export const useSavedJobs = () => useStored<StoredJob[]>('savedJobs', [])
export const useDismissedJobs = () => useStored<StoredJob[]>('dismissedJobs', [])
export const usePastSearches = () => useStored<PastSearch[]>('pastSearches', [])

/** Adds the job to a list, or removes it when it is already there. Newest first, capped. */
export function toggleJob(list: StoredJob[], job: Job): StoredJob[] {
  if (list.some((j) => j.id === job.id)) return list.filter((j) => j.id !== job.id)
  return [{ ...job, at: new Date().toISOString() }, ...list].slice(0, MAX_JOBS)
}

const norm = (s: string) => s.trim().toLowerCase()

/** Records a search; repeating one moves it to the top instead of adding a duplicate. */
export function addPastSearch(list: PastSearch[], s: Omit<PastSearch, 'id' | 'at'>): PastSearch[] {
  const same = (p: PastSearch) =>
    norm(p.q) === norm(s.q) && norm(p.location) === norm(s.location) && p.remote === s.remote && [...p.excluded].sort().join() === [...s.excluded].sort().join()
  const prev = list.find(same)
  return [{ ...s, id: prev?.id ?? newId(), at: new Date().toISOString() }, ...list.filter((p) => !same(p))].slice(0, MAX_PAST)
}
