/**
 * IM policy enforcement: DM policy, group policy, trigger mode, whitelists.
 */

import { getDb } from '@/lib/db'
import type { IncomingMessage } from './types'

export type PolicyResult =
  | { allowed: true }
  | { allowed: false; reason: string }

interface ChannelPolicies {
  dm_policy: string
  group_policy: string
  trigger_mode: string
  group_whitelist: string
  sender_whitelist: string
}

export function checkPolicy(msg: IncomingMessage): PolicyResult {
  const db = getDb()
  const channel = db.prepare('SELECT dm_policy, group_policy, trigger_mode, group_whitelist, sender_whitelist FROM im_channels WHERE id = ?')
    .get(msg.channelId) as ChannelPolicies | undefined

  if (!channel) {
    console.warn(`[Policy] Channel not found for id="${msg.channelId}" — ensure channelId is the DB UUID, not the platform type`)
    return { allowed: false, reason: 'Channel not found' }
  }

  console.log(`[Policy] Checking: isDm=${msg.isDm}, isGroupMention=${msg.isGroupMention}, dm_policy=${channel.dm_policy}, group_policy=${channel.group_policy}, trigger_mode=${channel.trigger_mode}`)

  if (msg.isDm) {
    return checkDmPolicy(channel.dm_policy, msg, channel.sender_whitelist)
  }
  return checkGroupPolicy(channel, msg)
}

function checkDmPolicy(policy: string, msg: IncomingMessage, senderWhitelistStr: string): PolicyResult {
  switch (policy) {
    case 'disabled':
      return { allowed: false, reason: 'DM is disabled' }
    case 'open':
      return { allowed: true }
    case 'allowlist':
    case 'pairing': {
      // pairing treated as allowlist for now (pairing code system TBD)
      const whitelist = parseJsonArray(senderWhitelistStr)
      if (whitelist.includes(msg.senderId)) return { allowed: true }
      return { allowed: false, reason: policy === 'pairing' ? 'Sender not paired' : 'Sender not in allowlist' }
    }
    default:
      return { allowed: false, reason: `Unknown DM policy: ${policy}` }
  }
}

function checkGroupPolicy(channel: ChannelPolicies, msg: IncomingMessage): PolicyResult {
  switch (channel.group_policy) {
    case 'disabled':
      return { allowed: false, reason: 'Group chat is disabled' }
    case 'allowlist': {
      const groupWhitelist = parseJsonArray(channel.group_whitelist)
      if (!groupWhitelist.includes(msg.chatId)) {
        return { allowed: false, reason: 'Group not in allowlist' }
      }
      break
    }
    case 'open':
      break
    default:
      return { allowed: false, reason: `Unknown group policy: ${channel.group_policy}` }
  }

  // Check trigger mode
  if (channel.trigger_mode === 'mention' && !msg.isGroupMention) {
    return { allowed: false, reason: 'Bot not mentioned' }
  }

  return { allowed: true }
}

function parseJsonArray(str: string): string[] {
  try {
    const parsed = JSON.parse(str)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
