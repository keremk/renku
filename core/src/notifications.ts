/* eslint-disable no-unused-vars */
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';

export type NotificationType = 'progress' | 'success' | 'warning' | 'error';

export interface Notification {
  type: NotificationType;
  message: string;
  timestamp: string;
}

// eslint-disable-next-line no-unused-vars
export type NotificationHandler = (_notification: Notification) => void;

export interface NotificationBus {
  publish(notification: Notification): void;
  subscribe(handler: NotificationHandler): () => void;
  complete(): void;
}

export function createNotificationBus(): NotificationBus {
  const subscribers = new Set<NotificationHandler>();
  let completed = false;

  return {
    publish(notification) {
      if (completed) {
        throw createRuntimeError(
          RuntimeErrorCode.NOTIFICATION_BUS_COMPLETED,
          'NotificationBus is completed and cannot publish new notifications.',
        );
      }
      subscribers.forEach((handler) => handler(notification));
    },
    subscribe(handler) {
      if (completed) {
        throw createRuntimeError(
          RuntimeErrorCode.NOTIFICATION_BUS_COMPLETED,
          'NotificationBus is completed and cannot accept subscribers.',
        );
      }
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
    complete() {
      completed = true;
      subscribers.clear();
    },
  };
}
/* eslint-disable no-unused-vars */
