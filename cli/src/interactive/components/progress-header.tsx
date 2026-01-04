import React from 'react';
import { Box, Text } from 'ink';

/**
 * Steps in the interactive input gathering flow.
 */
export type InteractiveStep = 'loading' | 'model-selection' | 'input-gathering' | 'confirmation' | 'saving';

/**
 * Step configuration for display.
 */
interface StepConfig {
  label: string;
  number: number;
}

const STEPS: Record<InteractiveStep, StepConfig> = {
  loading: { label: 'Loading blueprint...', number: 0 },
  'model-selection': { label: 'Select Models', number: 1 },
  'input-gathering': { label: 'Enter Inputs', number: 2 },
  confirmation: { label: 'Confirm', number: 3 },
  saving: { label: 'Saving...', number: 4 },
};

const TOTAL_STEPS = 3; // model-selection, input-gathering, confirmation

/**
 * Props for the ProgressHeader component.
 */
export interface ProgressHeaderProps {
  /** Current step in the flow */
  currentStep: InteractiveStep;
  /** Blueprint name being configured */
  blueprintName?: string;
  /** Additional status message */
  statusMessage?: string;
}

/**
 * Progress header showing current step in the interactive flow.
 */
export const ProgressHeader: React.FC<ProgressHeaderProps> = ({
  currentStep,
  blueprintName,
  statusMessage,
}) => {
  const step = STEPS[currentStep];
  const isMainStep = step.number >= 1 && step.number <= TOTAL_STEPS;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title bar */}
      <Box>
        <Text bold color="cyan">
          ◆ Interactive Input Setup
        </Text>
        {blueprintName && (
          <Text dimColor> • {blueprintName}</Text>
        )}
      </Box>

      {/* Progress indicator */}
      {isMainStep && (
        <Box marginTop={1}>
          <Text>Step </Text>
          <Text bold color="cyan">{step.number}</Text>
          <Text> of </Text>
          <Text>{TOTAL_STEPS}</Text>
          <Text>: </Text>
          <Text bold>{step.label}</Text>
        </Box>
      )}

      {/* Loading/saving indicator */}
      {(currentStep === 'loading' || currentStep === 'saving') && (
        <Box marginTop={1}>
          <Text color="yellow">⏳ {step.label}</Text>
        </Box>
      )}

      {/* Status message */}
      {statusMessage && (
        <Box marginTop={1}>
          <Text dimColor>{statusMessage}</Text>
        </Box>
      )}

      {/* Separator */}
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(50)}</Text>
      </Box>
    </Box>
  );
};

/**
 * Step indicator showing progress through all steps.
 */
export const StepIndicator: React.FC<{ currentStep: InteractiveStep }> = ({ currentStep }) => {
  const current = STEPS[currentStep].number;

  return (
    <Box>
      {[1, 2, 3].map((stepNum) => {
        const isCompleted = stepNum < current;
        const isCurrent = stepNum === current;

        let color: string | undefined;
        let symbol: string;

        if (isCompleted) {
          color = 'green';
          symbol = '●';
        } else if (isCurrent) {
          color = 'cyan';
          symbol = '◆';
        } else {
          color = 'gray';
          symbol = '○';
        }

        return (
          <React.Fragment key={stepNum}>
            <Text color={color}>{symbol}</Text>
            {stepNum < 3 && <Text dimColor> ─ </Text>}
          </React.Fragment>
        );
      })}
    </Box>
  );
};

/**
 * Footer with navigation hints.
 */
export interface NavigationFooterProps {
  /** Show back navigation hint */
  canGoBack?: boolean;
  /** Show next/submit action hint */
  nextLabel?: string;
  /** Show cancel hint */
  showCancel?: boolean;
  /** Additional hints */
  hints?: string[];
}

export const NavigationFooter: React.FC<NavigationFooterProps> = ({
  canGoBack = false,
  nextLabel = 'Continue',
  showCancel = true,
  hints = [],
}) => {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>{'─'.repeat(50)}</Text>
      </Box>
      <Box marginTop={1} gap={2}>
        {canGoBack && <Text dimColor>Esc: Back</Text>}
        <Text dimColor>Enter: {nextLabel}</Text>
        {showCancel && <Text dimColor>Ctrl+C: Cancel</Text>}
      </Box>
      {hints.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>{hints.join(' • ')}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Error message display.
 */
export const ErrorMessage: React.FC<{ message: string }> = ({ message }) => (
  <Box marginY={1}>
    <Text color="red">✗ Error: {message}</Text>
  </Box>
);

/**
 * Success message display.
 */
export const SuccessMessage: React.FC<{ message: string }> = ({ message }) => (
  <Box marginY={1}>
    <Text color="green">✓ {message}</Text>
  </Box>
);

/**
 * Warning message display.
 */
export const WarningMessage: React.FC<{ message: string }> = ({ message }) => (
  <Box marginY={1}>
    <Text color="yellow">⚠ {message}</Text>
  </Box>
);
