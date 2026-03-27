import { describe, expect, it } from 'vitest';
import { onboardingHandlerTestUtils } from './handler.js';

const {
  parsePortalRequestPath,
  parsePortalMonitorOutput,
  parsePortalResponseCode,
} = onboardingHandlerTestUtils;

describe('onboarding folder picker portal parsing', () => {
  it('parses request object path from quoted gdbus output', () => {
    const output =
      "(objectpath '/org/freedesktop/portal/desktop/request/1_220/renkuabc123',)";

    expect(parsePortalRequestPath(output)).toBe(
      '/org/freedesktop/portal/desktop/request/1_220/renkuabc123'
    );
  });

  it('parses request object path from unquoted gdbus output', () => {
    const output =
      '(objectpath /org/freedesktop/portal/desktop/request/1_220/renkuabc123,)';

    expect(parsePortalRequestPath(output)).toBe(
      '/org/freedesktop/portal/desktop/request/1_220/renkuabc123'
    );
  });

  it('parses Arch-style compact Response signal with selected folder', () => {
    const output = [
      'Monitoring signals on object /org/freedesktop/portal/desktop/request/1_220/renkuabc123 owned by org.freedesktop.portal.Desktop',
      'The name org.freedesktop.portal.Desktop is owned by :1.91',
      "/org/freedesktop/portal/desktop/request/1_220/renkuabc123: org.freedesktop.portal.Request.Response (0, {'uris': <['file:///home/test-user/Renku%20Workspace']>})",
    ].join('\n');

    expect(parsePortalResponseCode(output)).toBe(0);
    expect(parsePortalMonitorOutput(output, { final: false })).toEqual({
      status: 'selected',
      path: '/home/test-user/Renku Workspace',
    });
  });

  it('parses cancellation from compact Response signal', () => {
    const output =
      '/org/freedesktop/portal/desktop/request/1_220/renkuabc123: org.freedesktop.portal.Request.Response (1, {})';

    expect(parsePortalResponseCode(output)).toBe(1);
    expect(parsePortalMonitorOutput(output, { final: false })).toEqual({
      status: 'cancelled',
    });
  });

  it('parses member=Response multiline output with selected folder', () => {
    const output = [
      'signal time=1774513368.104 sender=:1.89 -> destination=(null destination) serial=38 path=/org/freedesktop/portal/desktop/request/1_220/renkuabc123; interface=org.freedesktop.portal.Request; member=Response',
      '   uint32 0',
      '   array [',
      '      dict entry(',
      '         string "uris"',
      '         variant             array [',
      '               string "file:///home/test-user/renku-workspace"',
      '            ]',
      '      )',
      '   ]',
    ].join('\n');

    expect(parsePortalResponseCode(output)).toBe(0);
    expect(parsePortalMonitorOutput(output, { final: false })).toEqual({
      status: 'selected',
      path: '/home/test-user/renku-workspace',
    });
  });

  it('keeps waiting for path when response is partial and final=false', () => {
    const output =
      '/org/freedesktop/portal/desktop/request/1_220/renkuabc123: org.freedesktop.portal.Request.Response (0, {})';

    expect(parsePortalMonitorOutput(output, { final: false })).toBeNull();
  });

  it('fails when response has no path and final=true', () => {
    const output =
      '/org/freedesktop/portal/desktop/request/1_220/renkuabc123: org.freedesktop.portal.Request.Response (0, {})';

    expect(parsePortalMonitorOutput(output, { final: true })).toEqual({
      status: 'failed',
      reason: 'xdg-desktop-portal did not return a selected folder path.',
    });
  });
});
