'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TaskExecution } from '@/lib/types'

interface DbTaskExecution {
  id: string
  task_id: string
  task_name: string
  result: string
  status: string
  session_id: string
  executed_at: string
}

function mapExecution(row: DbTaskExecution): TaskExecution {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    result: row.result,
    status: row.status as TaskExecution['status'],
    sessionId: row.session_id || '',
    executedAt: row.executed_at,
  }
}

const PAGE_SIZE = 20

export function useTaskExecutions(workspaceId?: string) {
  const [executions, setExecutions] = useState<TaskExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const offsetRef = useRef(0)

  const buildParams = useCallback((offset: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (workspaceId) params.set('workspace_id', workspaceId)
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    return params
  }, [workspaceId, typeFilter, statusFilter])

  const fetchExecutions = useCallback(async () => {
    setLoading(true)
    offsetRef.current = 0
    try {
      const params = buildParams(0)
      const res = await fetch(`/api/task-executions?${params}`)
      const data = (await res.json()) as DbTaskExecution[]
      const mapped = data.map(mapExecution)
      setExecutions(mapped)
      setHasMore(mapped.length >= PAGE_SIZE)
      offsetRef.current = mapped.length
    } catch (err) {
      console.error('Failed to fetch task executions:', err)
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  const loadMore = useCallback(async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const params = buildParams(offsetRef.current)
      const res = await fetch(`/api/task-executions?${params}`)
      const data = (await res.json()) as DbTaskExecution[]
      const mapped = data.map(mapExecution)
      setExecutions(prev => [...prev, ...mapped])
      setHasMore(mapped.length >= PAGE_SIZE)
      offsetRef.current += mapped.length
    } catch (err) {
      console.error('Failed to load more executions:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [buildParams, loadingMore])

  useEffect(() => { fetchExecutions() }, [fetchExecutions])

  return {
    executions,
    loading,
    loadingMore,
    hasMore,
    typeFilter,
    statusFilter,
    setTypeFilter,
    setStatusFilter,
    loadMore,
    refreshExecutions: fetchExecutions,
  }
}
