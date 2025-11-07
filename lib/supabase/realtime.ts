import { createClient } from './client'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Realtime utility functions for Supabase Realtime features:
 * - Broadcast: Send low-latency messages between clients
 * - Presence: Track and synchronize user state across clients
 * - Postgres Changes: Listen to database changes in real-time
 */

/**
 * Broadcast utility - Send messages to a channel
 * @param channelName - The name of the channel to broadcast to
 * @param event - The event name to broadcast
 * @param payload - The data to send
 */
export async function broadcast(channelName: string, event: string, payload: any) {
  const supabase = createClient()
  const channel = supabase.channel(channelName)
  
  await channel.send({
    type: 'broadcast',
    event,
    payload,
  })
  
  return channel
}

/**
 * Subscribe to broadcast messages on a channel
 * @param channelName - The name of the channel to subscribe to
 * @param event - The event name to listen for
 * @param callback - Callback function when message is received
 * @returns The channel subscription
 */
export function subscribeToBroadcast<T = any>(
  channelName: string,
  event: string,
  callback: (payload: T) => void
): RealtimeChannel {
  const supabase = createClient()
  const channel = supabase.channel(channelName)
  
  channel
    .on('broadcast', { event }, ({ payload }) => {
      callback(payload as T)
    })
    .subscribe()
  
  return channel
}

/**
 * Presence utility - Track user presence on a channel
 * @param channelName - The name of the channel
 * @param presenceData - The presence data to track
 * @param callback - Callback when presence changes
 * @param userId - Optional user ID for presence key (defaults to 'anonymous')
 * @returns The channel subscription
 */
export async function trackPresence<T extends Record<string, any> = Record<string, any>>(
  channelName: string,
  presenceData: T,
  callback?: (state: any, key: string, currentPresences: any, newPresences: any) => void,
  userId?: string
): Promise<RealtimeChannel> {
  const supabase = createClient()
  
  // Get user ID if not provided
  let presenceKey = userId || 'anonymous'
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    presenceKey = data.user?.id || 'anonymous'
  }
  
  const channel = supabase.channel(channelName, {
    config: {
      presence: {
        key: presenceKey,
      },
    },
  })
  
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      callback?.(state, '', {}, {})
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const state = channel.presenceState()
      callback?.(state, key, {}, newPresences)
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      const state = channel.presenceState()
      callback?.(state, key, leftPresences, {})
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track(presenceData)
      }
    })
  
  return channel
}

/**
 * Subscribe to database changes (Postgres Changes)
 * @param table - The table name to listen to
 * @param filter - Optional filter (e.g., 'id=eq.123')
 * @param callback - Callback when changes occur
 * @returns The channel subscription
 */
export function subscribeToPostgresChanges<T = any>(
  table: string,
  filter?: string,
  callback?: (payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new?: T
    old?: T
  }) => void
): RealtimeChannel {
  const supabase = createClient()
  const channel = supabase.channel(`${table}:changes`)
  
  const config = {
    event: '*',
    schema: 'public',
    table,
    ...(filter && { filter }),
  }
  
  channel
    .on('postgres_changes', config, (payload: any) => {
      callback?.({
        eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
        new: payload.new as T,
        old: payload.old as T,
      })
    })
    .subscribe()
  
  return channel
}

/**
 * Unsubscribe from a channel
 * @param channel - The channel to unsubscribe from
 */
export function unsubscribe(channel: RealtimeChannel) {
  const supabase = createClient()
  supabase.removeChannel(channel)
}

