import type {
  HandlerFactory,
  HandlerFactoryInit,
  ProducerHandler,
  ProviderResult,
} from '../types.js';
import { createProducerRuntime } from './runtime.js';
import type {
  ProducerDomain,
  ProducerInvokeFn,
  ProducerWarmStartFn,
} from './types.js';

export interface CreateProducerHandlerFactoryOptions {
  domain: ProducerDomain;
  invoke: ProducerInvokeFn;
  configValidator?: (value: unknown) => unknown;
  warmStart?: ProducerWarmStartFn;
  notificationKey?: string;
}

export function createProducerHandlerFactory(
  options: CreateProducerHandlerFactoryOptions,
): HandlerFactory {
  return (init: HandlerFactoryInit): ProducerHandler => {
    const { descriptor } = init;
    const notificationKey = options.notificationKey ?? `${descriptor.provider}/${descriptor.model}`;
    const handler: ProducerHandler = {
      provider: descriptor.provider,
      model: descriptor.model,
      environment: descriptor.environment,
      mode: init.mode,
      warmStart: options.warmStart
        ? async (context) => {
            init.notifications?.publish({
              type: 'progress',
              message: `Warm starting ${notificationKey}`,
              timestamp: new Date().toISOString(),
            });
            await options.warmStart?.({
              handler,
              logger: context.logger ?? init.logger,
              notifications: init.notifications,
            });
          }
        : undefined,
      async invoke(request): Promise<ProviderResult> {
        const runtime = createProducerRuntime({
          descriptor,
          domain: options.domain,
          request,
          logger: init.logger,
          configValidator: options.configValidator,
          mode: init.mode,
          notifications: init.notifications,
          cloudStorage: init.cloudStorage,
        });
        return options.invoke({
          request,
          runtime,
        });
      },
    };
    return handler;
  };
}
