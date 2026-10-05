/** The account the credentials sign in as. */
export type XAccount = { id: string; username: string; name: string }

/** A post the agent wrote, waiting for the person's approval. */
export type XDraft = {
  id: string
  text: string
  /** Reply to this post id, when it is a reply. */
  replyTo?: string
  /** Who wrote it: the persona id at the time. */
  persona: string
  createdAt: number
  /** X's weighted length (URLs count 23, wide characters 2), at most 280. */
  weighted: number
}

/** A post that went out: the audit trail. */
export type XPosted = { id: string; text: string; at: number; url: string; replyTo?: string; persona: string }

export type XMention = { id: string; text: string; author: string; at: string }

declare module 'claude-code' {
  interface PluginState {
    'x-bridge': {
      account: XAccount | null
      drafts: XDraft[]
      posted: XPosted[]
      mentions: XMention[]
      /** One line on what the bridge is doing or why it cannot. */
      status: string
    }
  }
}
