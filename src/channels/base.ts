/**
 * @module channels/base
 * Core types and abstract base class for all SoterFlow channel connectors.
 */

/** Represents a single actionable item from any connected channel. */
export interface WorkItem {
  id: string;
  source: string;
  type: "mention" | "task" | "message" | "pr" | "issue" | "notification";
  title: string;
  body: string;
  author: string;
  timestamp: Date;
  priority: "urgent" | "high" | "normal" | "low";
  url: string;
  metadata: Record<string, unknown>;
  status: "new" | "seen" | "in_progress" | "done" | "dismissed";
}

/**
 * Abstract base class for channel connectors.
 * Each connector fetches work items from an external service and maps them to WorkItem.
 */
export abstract class BaseChannel {
  /** Unique name identifying this channel (e.g. 'github', 'jira'). */
  abstract name: string;

  /** Whether the channel is currently connected. */
  protected _connected = false;

  /** Check if channel is connected. */
  isConnected(): boolean {
    return this._connected;
  }

  /** Establish connection / authenticate with the external service. */
  abstract connect(): Promise<void>;

  /** Tear down connection and clean up resources. */
  abstract disconnect(): Promise<void>;

  /** Fetch new/updated items from the channel and return them as WorkItems. */
  abstract sync(): Promise<WorkItem[]>;

  /**
   * Perform an action on a work item (e.g. close, comment, merge).
   * @param itemId - The work item ID
   * @param action - Action name (channel-specific)
   * @param params - Optional parameters for the action
   */
  abstract performAction(
    itemId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
}
