/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, render } from 'ink';
import type { ExecutionPlan } from '@renku/core';
import type { JSX } from 'react';

interface PlanConfirmationProps {
  plan: ExecutionPlan;
  concurrency?: number;
  upToLayer?: number;
  onComplete: (confirmed: boolean) => void;
}

function Summary({ plan, concurrency, upToLayer }: PlanConfirmationProps): JSX.Element {
  const allJobs = plan.layers.flat();
  const byProducer = new Map<string, number>();
  for (const job of allJobs) {
    byProducer.set(job.producer, (byProducer.get(job.producer) ?? 0) + 1);
  }

  const layerSummaries = plan.layers.map((layer, index) => {
    const producerCounts = new Map<string, number>();
    for (const job of layer) {
      producerCounts.set(job.producer, (producerCounts.get(job.producer) ?? 0) + 1);
    }
    const producersLabel = Array.from(producerCounts.entries())
      .map(([producer, count]) => `${producer}${count > 1 ? ` x${count}` : ''}`)
      .join(', ');
    return {
      index,
      jobs: layer.length,
      producersLabel,
    };
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan">=== Execution Plan Summary ===</Text>
      <Text>Revision: {plan.revision}</Text>
      <Text>
        Total Jobs: {allJobs.length} | Layers: {plan.layers.length} | Concurrency:{' '}
        {concurrency ?? 1}
      </Text>
      {typeof upToLayer === 'number' ? (
        <Text>
          Layer limit: running layers 0-{Math.min(upToLayer, Math.max(plan.layers.length - 1, 0))}
        </Text>
      ) : null}
      <Text>Jobs by Producer:</Text>
      {Array.from(byProducer.entries()).map(([producer, count]) => (
        <Text key={producer}>  • {producer}: {count}</Text>
      ))}
      <Text>Layers:</Text>
      {layerSummaries.map((layer) => (
        <Text key={layer.index}>
          {`  • Layer ${layer.index}: ${layer.jobs} job${layer.jobs === 1 ? '' : 's'}`}{' '}
          {layer.producersLabel ? `(${layer.producersLabel})` : ''}
        </Text>
      ))}
    </Box>
  );
}

function PlanConfirmView(props: PlanConfirmationProps): JSX.Element {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'cancelled'>('pending');

  useInput((input) => {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      setStatus('confirmed');
      props.onComplete(true);
    }
    if (normalized === 'n' || normalized === 'no') {
      setStatus('cancelled');
      props.onComplete(false);
    }
  });

  useEffect(() => {
    return () => {
      if (status === 'pending') {
        props.onComplete(false);
      }
    };
  }, [status, props]);

  return (
    <Box flexDirection="column">
      <Summary {...props} />
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">Proceed with execution? (y/n)</Text>
        {status === 'confirmed' && <Text color="green">Confirmed. Running...</Text>}
        {status === 'cancelled' && <Text color="red">Cancelled.</Text>}
      </Box>
    </Box>
  );
}

export async function confirmPlanWithInk(args: {
  plan: ExecutionPlan;
  concurrency?: number;
  upToLayer?: number;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const handleComplete = (confirmed: boolean) => {
      resolve(confirmed);
      app.unmount();
    };
    const app = render(
      <PlanConfirmView
        plan={args.plan}
        concurrency={args.concurrency}
        upToLayer={args.upToLayer}
        onComplete={handleComplete}
      />,
    );
  });
}
