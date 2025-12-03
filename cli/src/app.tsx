import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { Notification, NotificationBus } from '@renku/core';

type Props = {
  bus: NotificationBus;
};

type NotificationItem = Notification & { id: string };

function colorFor(type: Notification['type']): string {
  if (type === 'success') {
    return 'green';
  }
  if (type === 'warning') {
    return 'yellow';
  }
  if (type === 'error') {
    return 'red';
  }
  return 'cyan';
}

export default function NotificationApp({ bus }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let counter = 0;
    const unsubscribe = bus.subscribe((notification: Notification) => {
      counter += 1;
      setItems((prev) => {
        const next = [...prev, { ...notification, id: `${counter}-${notification.timestamp}` }];
        return next.slice(-10);
      });
    });
    return unsubscribe;
  }, [bus]);

  return (
    <Box flexDirection="column">
      <Text color="cyan">Renku</Text>
      {items.map((item) => (
        <Text key={item.id} color={colorFor(item.type)}>
          {item.message}
        </Text>
      ))}
    </Box>
  );
}
