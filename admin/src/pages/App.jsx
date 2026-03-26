import React from 'react';
import { Page, Layouts, useFetchClient } from '@strapi/strapi/admin';
import {
  Alert,
  Badge,
  BaseLink,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Textarea,
  TextInput,
  Th,
  Thead,
  Toggle,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import pluginId from '../pluginId';

function defaultCoreSettings() {
  return {
    accessToken: '',
    connected: false,
    authKeyId: '',
    authVerificationUrl: '',
    authSessionStatus: 'idle',
    authMode: '',
    projectId: '',
    projectSlug: '',
    projectType: '',
    userSlug: '',
    userName: '',
    userEmail: '',
    userPlan: -1,
    userPlanLabel: '',
    guestName: '',
    publicBaseUrl: '',
    lastConnectionAt: '',
    lastStatusSyncAt: '',
    lastProjectCreationAt: '',
    lastAuthStartedAt: '',
  };
}

function defaultApiAcceleratorSettings() {
  return {
    defaultQueryString: '',
    protectedAssets: false,
    blockGetMode: 'no',
    collectionSyncPerPage: 50,
    autoSyncFrequency: 'hourly',
    includeContentTypes: [],
    manualRoutes: [],
    lastDiscoveryAt: '',
    lastSyncAt: '',
    lastAutoSyncAt: '',
    debounceMs: 5000,
  };
}

function defaultAccount() {
  return {
    connected: false,
    authKeyId: '',
    authVerificationUrl: '',
    authSessionStatus: 'idle',
    authMode: '',
    projectId: '',
    projectSlug: '',
    projectType: '',
    userSlug: '',
    userName: '',
    userEmail: '',
    userPlan: -1,
    userPlanLabel: '',
    guestName: '',
    publicBaseUrl: '',
    lastConnectionAt: '',
    lastStatusSyncAt: '',
    lastProjectCreationAt: '',
    lastAuthStartedAt: '',
    dashboardUrl: '',
  };
}

function stringifyList(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function normalizeApiAcceleratorForSubmit(settings) {
  return {
    ...settings,
    includeContentTypes: settings.includeContentTypesText,
    manualRoutes: settings.manualRoutesText,
  };
}

function formatDateTime(value) {
  if (!value) {
    return 'Not available';
  }

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function MetricCard({ label, value, hint }) {
  return (
    <Box background="neutral0" hasRadius shadow="filterShadow" padding={5}>
      <Flex direction="column" gap={1} alignItems="stretch">
        <Typography variant="sigma" textColor="neutral600">
          {label}
        </Typography>
        <Typography variant="beta" tag="p">
          {value}
        </Typography>
        {hint ? (
          <Typography variant="pi" textColor="neutral600">
            {hint}
          </Typography>
        ) : null}
      </Flex>
    </Box>
  );
}

function SectionCard({ title, subtitle, badge, actions, children }) {
  return (
    <Box background="neutral0" hasRadius shadow="filterShadow" padding={7}>
      <Flex direction="column" gap={6} alignItems="stretch">
        <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
          <Flex direction="column" gap={1} alignItems="stretch">
            <Typography variant="delta" tag="h2">
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="pi" textColor="neutral600">
                {subtitle}
              </Typography>
            ) : null}
          </Flex>
          <Flex gap={2} alignItems="center" wrap="wrap">
            {badge ? <Badge>{badge}</Badge> : null}
            {actions}
          </Flex>
        </Flex>
        {children}
      </Flex>
    </Box>
  );
}

function TextField({ label, hint, ...props }) {
  return (
    <Field.Root hint={hint}>
      <Field.Label>{label}</Field.Label>
      <TextInput {...props} />
      {hint ? <Field.Hint /> : null}
    </Field.Root>
  );
}

function SelectField({ label, hint, children, ...props }) {
  return (
    <Field.Root hint={hint}>
      <Field.Label>{label}</Field.Label>
      <SingleSelect {...props}>{children}</SingleSelect>
      {hint ? <Field.Hint /> : null}
    </Field.Root>
  );
}

function TextAreaField({ label, hint, ...props }) {
  return (
    <Field.Root hint={hint}>
      <Field.Label>{label}</Field.Label>
      <Textarea {...props} />
      {hint ? <Field.Hint /> : null}
    </Field.Root>
  );
}

export default function App() {
  const client = useFetchClient();
  const [isReady, setIsReady] = React.useState(false);
  const [coreSettings, setCoreSettings] = React.useState(defaultCoreSettings());
  const [account, setAccount] = React.useState(defaultAccount());
  const [modules, setModules] = React.useState([]);
  const [apiAcceleratorSettings, setApiAcceleratorSettings] = React.useState({
    ...defaultApiAcceleratorSettings(),
    includeContentTypesText: '',
    manualRoutesText: '',
  });
  const [apiAcceleratorEndpoints, setApiAcceleratorEndpoints] = React.useState([]);
  const [apiAcceleratorStats, setApiAcceleratorStats] = React.useState({
    total: 0,
    syncable: 0,
    uploaded: 0,
    failed: 0,
  });
  const [message, setMessage] = React.useState(null);
  const [busyAction, setBusyAction] = React.useState('');

  const isBusy = Boolean(busyAction);
  const apiAcceleratorModule = modules.find((module) => module.id === 'api-accelerator') || null;
  const placeholderModules = modules.filter((module) => module.id !== 'api-accelerator');

  const hydrate = React.useCallback((payload) => {
    const nextCore = payload?.core?.settings || defaultCoreSettings();
    const nextAccount = payload?.core?.account || defaultAccount();
    const nextApiAccelerator = payload?.apiAccelerator?.settings || defaultApiAcceleratorSettings();

    setCoreSettings(nextCore);
    setAccount({
      ...defaultAccount(),
      ...nextAccount,
    });
    setModules(Array.isArray(payload?.modules) ? payload.modules : []);
    setApiAcceleratorSettings({
      ...nextApiAccelerator,
      includeContentTypesText: stringifyList(nextApiAccelerator.includeContentTypes),
      manualRoutesText: stringifyList(nextApiAccelerator.manualRoutes),
    });
    setApiAcceleratorEndpoints(Array.isArray(payload?.apiAccelerator?.endpoints) ? payload.apiAccelerator.endpoints : []);
    setApiAcceleratorStats(
      payload?.apiAccelerator?.stats || {
        total: 0,
        syncable: 0,
        uploaded: 0,
        failed: 0,
      }
    );
  }, []);

  const load = React.useCallback(async () => {
    setBusyAction('Loading');
    try {
      const response = await client.get(`/${pluginId}/bootstrap`);
      hydrate(response.data?.data || {});
    } catch (error) {
      setMessage({
        type: 'danger',
        text: error.message || 'Could not load the Smooth CDN plugin data.',
      });
    } finally {
      setBusyAction('');
      setIsReady(true);
    }
  }, [client, hydrate]);

  React.useEffect(() => {
    load();
  }, [load]);

  const refresh = React.useCallback(async () => {
    const response = await client.get(`/${pluginId}/bootstrap`);
    hydrate(response.data?.data || {});
  }, [client, hydrate]);

  const runAction = React.useCallback(async (label, callback, successMessage) => {
    setBusyAction(label);
    setMessage(null);

    try {
      const result = await callback();
      if (successMessage) {
        setMessage({
          type: 'success',
          text: successMessage,
        });
      }
      await refresh();
      return result;
    } catch (error) {
      setMessage({
        type: 'danger',
        text: error?.response?.data?.error?.message || error.message || 'Request failed.',
      });
      throw error;
    } finally {
      setBusyAction('');
    }
  }, [refresh]);

  const syncStatus = React.useCallback(async (silent = false) => {
    if (!account.connected) {
      return null;
    }

    try {
      const response = await client.post(`/${pluginId}/core/status-sync`, {});
      if (response.data?.data?.account) {
        setAccount((current) => ({
          ...current,
          ...response.data.data.account,
        }));
      }
      return response.data?.data || null;
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'danger',
          text: error?.response?.data?.error?.message || error.message || 'Could not refresh account status.',
        });
      }
      return null;
    }
  }, [account.connected, client]);

  const pollLogin = React.useCallback(async (silent = false) => {
    if (!account.authKeyId || account.connected) {
      return null;
    }

    try {
      const response = await client.post(`/${pluginId}/core/auth/poll`, {
        keyId: account.authKeyId,
      });
      if (response.data?.data?.account) {
        setAccount((current) => ({
          ...current,
          ...response.data.data.account,
        }));
      }
      if (response.data?.data?.settings) {
        setCoreSettings((current) => ({
          ...current,
          ...response.data.data.settings,
        }));
      }
      if (!silent && response.data?.data?.status === 'active') {
        setMessage({
          type: 'success',
          text: 'Connected to Smooth CDN.',
        });
      }
      return response.data?.data || null;
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'danger',
          text: error?.response?.data?.error?.message || error.message || 'Could not poll the login session.',
        });
      }
      await refresh();
      return null;
    }
  }, [account.authKeyId, account.connected, client, refresh]);

  React.useEffect(() => {
    if (!account.authKeyId || account.connected) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      pollLogin(true).catch(() => null);
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [account.authKeyId, account.connected, pollLogin]);

  React.useEffect(() => {
    if (!account.connected) {
      return undefined;
    }

    syncStatus(true).catch(() => null);
    const interval = window.setInterval(() => {
      syncStatus(true).catch(() => null);
    }, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, [account.connected, syncStatus]);

  function updateCoreField(key, value) {
    setCoreSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateApiAcceleratorField(key, value) {
    setApiAcceleratorSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveCore() {
    await runAction(
      'Saving core',
      async () => {
        const response = await client.put(`/${pluginId}/core/settings`, {
          publicBaseUrl: coreSettings.publicBaseUrl,
          guestName: coreSettings.guestName,
        });
        if (response.data?.data?.settings) {
          setCoreSettings((current) => ({
            ...current,
            ...response.data.data.settings,
          }));
        }
      },
      'Core settings saved.'
    );
  }

  async function startBrowserLogin() {
    const result = await runAction(
      'Starting browser login',
      async () => {
        const response = await client.post(`/${pluginId}/core/auth/start`, {
          guest: false,
        });
        if (response.data?.data?.account) {
          setAccount((current) => ({
            ...current,
            ...response.data.data.account,
          }));
        }
        if (response.data?.data?.settings) {
          setCoreSettings((current) => ({
            ...current,
            ...response.data.data.settings,
          }));
        }
        return response.data?.data || null;
      },
      'Browser login started. Finish the sign-in in the opened tab.'
    );

    const verificationUrl = result?.verificationUrl || result?.account?.authVerificationUrl;
    if (verificationUrl) {
      window.open(verificationUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function startGuestLogin() {
    await runAction(
      'Starting guest login',
      async () => {
        const response = await client.post(`/${pluginId}/core/auth/start`, {
          guest: true,
          name: coreSettings.guestName,
          url: coreSettings.publicBaseUrl,
        });
        if (response.data?.data?.account) {
          setAccount((current) => ({
            ...current,
            ...response.data.data.account,
          }));
        }
        if (response.data?.data?.settings) {
          setCoreSettings((current) => ({
            ...current,
            ...response.data.data.settings,
          }));
        }
      },
      'Guest login started.'
    );
  }

  async function disconnect() {
    await runAction(
      'Disconnecting',
      async () => {
        const response = await client.post(`/${pluginId}/core/disconnect`, {});
        if (response.data?.data?.account) {
          setAccount((current) => ({
            ...current,
            ...response.data.data.account,
          }));
        }
        if (response.data?.data?.settings) {
          setCoreSettings((current) => ({
            ...current,
            ...response.data.data.settings,
          }));
        }
      },
      'Disconnected from Smooth CDN.'
    );
  }

  async function toggleModule(moduleId, enabled) {
    const response = await runAction(
      enabled ? 'Enabling module' : 'Disabling module',
      async () => {
        const result = await client.post(`/${pluginId}/modules/${moduleId}/toggle`, {
          enabled,
        });
        if (result.data?.data?.modules) {
          setModules(result.data.data.modules);
        }
        if (result.data?.data?.account) {
          setAccount((current) => ({
            ...current,
            ...result.data.data.account,
          }));
        }
        return result.data?.data || null;
      },
      enabled ? 'Module enabled.' : 'Module disabled.'
    );

    if (enabled && response?.projectCreated) {
      setMessage({
        type: 'success',
        text: 'Module enabled and the initial Smooth CDN project was created.',
      });
    }
  }

  async function saveApiAcceleratorSettings() {
    await runAction(
      'Saving API Accelerator',
      async () => {
        const response = await client.put(
          `/${pluginId}/modules/api-accelerator/settings`,
          normalizeApiAcceleratorForSubmit(apiAcceleratorSettings)
        );

        if (response.data?.data) {
          const next = response.data.data;
          setApiAcceleratorSettings({
            ...next,
            includeContentTypesText: stringifyList(next.includeContentTypes),
            manualRoutesText: stringifyList(next.manualRoutes),
          });
        }
      },
      'API Accelerator settings saved.'
    );
  }

  async function discoverEndpoints() {
    await runAction(
      'Discovering',
      async () => {
        await client.post(`/${pluginId}/modules/api-accelerator/discover`, {});
      },
      'Endpoint discovery finished.'
    );
  }

  async function syncAll() {
    await runAction(
      'Syncing',
      async () => {
        await client.post(`/${pluginId}/modules/api-accelerator/sync`, {});
      },
      'Sync finished.'
    );
  }

  async function syncRoute(route) {
    await runAction(
      'Syncing route',
      async () => {
        await client.post(`/${pluginId}/modules/api-accelerator/sync`, {
          routes: [route],
        });
      },
      `Route ${route} synced.`
    );
  }

  async function purgeRoute(route) {
    await runAction(
      'Purging route',
      async () => {
        await client.post(`/${pluginId}/modules/api-accelerator/purge`, {
          routes: [route],
        });
      },
      `Route ${route} purged from Smooth CDN.`
    );
  }

  async function toggleSyncable(route, syncable) {
    await runAction(
      'Updating endpoint',
      async () => {
        await client.post(`/${pluginId}/modules/api-accelerator/syncable`, {
          route,
          syncable,
        });
      },
      `Endpoint ${syncable ? 'enabled' : 'disabled'} for sync.`
    );
  }

  if (!isReady) {
    return <Page.Loading />;
  }

  return (
    <Page.Main aria-busy={isBusy}>
      <Page.Title>Smooth CDN</Page.Title>
      <Layouts.Header
        title="Smooth CDN"
        subtitle="Browser-based Smooth CDN authentication plus module-based integrations for Strapi."
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          {message ? (
            <Alert
              title={message.type === 'success' ? 'Success' : 'Error'}
              variant={message.type === 'success' ? 'success' : 'danger'}
              closeLabel="Close alert"
            >
              {message.text}
            </Alert>
          ) : null}

          <Grid.Root gap={4}>
            <Grid.Item col={3} s={6} xs={12}>
              <MetricCard
                label="Connection"
                value={account.connected ? 'Connected' : account.authKeyId ? 'Waiting for approval' : 'Disconnected'}
                hint="Current Smooth CDN auth state"
              />
            </Grid.Item>
            <Grid.Item col={3} s={6} xs={12}>
              <MetricCard label="User" value={account.userSlug || 'n/a'} hint={account.userEmail || 'Not signed in'} />
            </Grid.Item>
            <Grid.Item col={3} s={6} xs={12}>
              <MetricCard label="Project" value={account.projectSlug || 'Not created'} hint={account.projectType || 'No project yet'} />
            </Grid.Item>
            <Grid.Item col={3} s={6} xs={12}>
              <MetricCard label="Enabled modules" value={String(modules.filter((module) => module.enabled).length)} hint="Modules are disabled by default" />
            </Grid.Item>
          </Grid.Root>

          <SectionCard
            title="Core"
            subtitle="Sign in to Smooth CDN, keep the account status fresh, and manage the shared project connection."
            badge={account.connected ? 'Connected' : account.authKeyId ? 'Pending' : 'Disconnected'}
            actions={
              <>
                <Button variant="secondary" onClick={() => syncStatus(false)} disabled={isBusy || !account.connected}>
                  Refresh status
                </Button>
                <Button onClick={saveCore} disabled={isBusy}>
                  {busyAction === 'Saving core' ? 'Saving...' : 'Save core'}
                </Button>
                <Button variant="danger-light" onClick={disconnect} disabled={isBusy || !account.connected}>
                  Disconnect
                </Button>
              </>
            }
          >
            {!account.connected ? (
              <Alert title="Authentication flow" variant="info" closeLabel="Close alert">
                Use browser login for a normal account or guest login to create a temporary guest account.
              </Alert>
            ) : null}

            <Grid.Root gap={4}>
              <Grid.Item col={6} xs={12}>
                <TextField
                  label="Public base URL"
                  hint="Used for guest login, project naming, and origin fetches."
                  name="publicBaseUrl"
                  value={coreSettings.publicBaseUrl || ''}
                  onChange={(event) => updateCoreField('publicBaseUrl', event.target.value)}
                />
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <TextField
                  label="Guest account name"
                  hint="Used only when creating a guest login session."
                  name="guestName"
                  value={coreSettings.guestName || ''}
                  onChange={(event) => updateCoreField('guestName', event.target.value)}
                />
              </Grid.Item>
            </Grid.Root>

            <Flex gap={3} wrap="wrap">
              <Button onClick={startBrowserLogin} disabled={isBusy || account.connected}>
                {busyAction === 'Starting browser login' ? 'Starting...' : 'Login in browser'}
              </Button>
              <Button variant="secondary" onClick={startGuestLogin} disabled={isBusy || account.connected}>
                {busyAction === 'Starting guest login' ? 'Starting...' : 'Continue as guest'}
              </Button>
              {account.authVerificationUrl ? (
                <Button variant="tertiary" onClick={() => window.open(account.authVerificationUrl, '_blank', 'noopener,noreferrer')}>
                  Open login page
                </Button>
              ) : null}
              {account.authKeyId && !account.connected ? (
                <Button variant="tertiary" onClick={() => pollLogin(false)}>
                  Check login status
                </Button>
              ) : null}
            </Flex>

            <Grid.Root gap={4}>
              <Grid.Item col={4} s={6} xs={12}>
                <MetricCard label="Plan" value={account.userPlanLabel || 'n/a'} hint={`Plan ID: ${account.userPlan ?? -1}`} />
              </Grid.Item>
              <Grid.Item col={4} s={6} xs={12}>
                <MetricCard label="Project ID" value={account.projectId || 'n/a'} hint="Created on first module enable" />
              </Grid.Item>
              <Grid.Item col={4} s={12} xs={12}>
                <MetricCard label="Auth session" value={account.authSessionStatus || 'idle'} hint={account.authMode || 'No auth session'} />
              </Grid.Item>
            </Grid.Root>

            <Flex direction="column" gap={1} alignItems="stretch">
              <Typography variant="pi" textColor="neutral600">
                Last connection: {formatDateTime(account.lastConnectionAt)}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                Last status sync: {formatDateTime(account.lastStatusSyncAt)}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                First project creation: {formatDateTime(account.lastProjectCreationAt)}
              </Typography>
              {account.dashboardUrl ? (
                <BaseLink href={account.dashboardUrl} isExternal>
                  Open project on Smooth CDN
                </BaseLink>
              ) : null}
            </Flex>
          </SectionCard>

          <SectionCard
            title="Modules"
            subtitle="Modules are disabled by default. The first enable action creates a Smooth CDN project automatically if one does not exist yet."
          >
            <Grid.Root gap={4}>
              {modules.map((module) => (
                <Grid.Item key={module.id} col={4} s={6} xs={12}>
                  <Box background="neutral100" hasRadius padding={5}>
                    <Flex direction="column" gap={4} alignItems="stretch">
                      <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
                        <Flex direction="column" gap={1} alignItems="stretch">
                          <Typography variant="epsilon" tag="h3">
                            {module.name}
                          </Typography>
                          <Typography variant="pi" textColor="neutral600">
                            {module.description}
                          </Typography>
                        </Flex>
                        <Badge>{module.implemented ? 'Implemented' : 'Placeholder'}</Badge>
                      </Flex>
                      <Field.Root name={`module-${module.id}`}>
                        <Toggle
                          checked={Boolean(module.enabled)}
                          disabled={isBusy}
                          offLabel="Disabled"
                          onLabel="Enabled"
                          onChange={(event) => toggleModule(module.id, event.target.checked)}
                        />
                      </Field.Root>
                      <Typography variant="pi" textColor="neutral600">
                        {module.enabled
                          ? 'This module is enabled.'
                          : 'This module is disabled.'}
                      </Typography>
                    </Flex>
                  </Box>
                </Grid.Item>
              ))}
            </Grid.Root>
          </SectionCard>

          <SectionCard
            title="API Accelerator"
            subtitle="Configure snapshot discovery, sync, purge, and automatic resync behavior for the Smooth CDN API Accelerator module."
            badge={apiAcceleratorModule?.enabled ? 'Enabled' : 'Disabled'}
            actions={
              <>
                <Button onClick={saveApiAcceleratorSettings} disabled={isBusy}>
                  {busyAction === 'Saving API Accelerator' ? 'Saving...' : 'Save settings'}
                </Button>
                <Button variant="secondary" onClick={discoverEndpoints} disabled={isBusy || !apiAcceleratorModule?.enabled}>
                  {busyAction === 'Discovering' ? 'Discovering...' : 'Discover endpoints'}
                </Button>
                <Button variant="secondary" onClick={syncAll} disabled={isBusy || !apiAcceleratorModule?.enabled}>
                  {busyAction === 'Syncing' ? 'Syncing...' : 'Sync all'}
                </Button>
              </>
            }
          >
            {!apiAcceleratorModule?.enabled ? (
              <Alert title="Module disabled" variant="warning" closeLabel="Close alert">
                Enable the API Accelerator module before discovery, sync, purge, and content-change automation can run.
              </Alert>
            ) : null}

            <Grid.Root gap={4}>
              <Grid.Item col={3} s={6} xs={12}>
                <MetricCard label="Detected routes" value={String(apiAcceleratorStats.total || 0)} />
              </Grid.Item>
              <Grid.Item col={3} s={6} xs={12}>
                <MetricCard label="Syncable routes" value={String(apiAcceleratorStats.syncable || 0)} />
              </Grid.Item>
              <Grid.Item col={3} s={6} xs={12}>
                <MetricCard label="Uploaded routes" value={String(apiAcceleratorStats.uploaded || 0)} />
              </Grid.Item>
              <Grid.Item col={3} s={6} xs={12}>
                <MetricCard label="Failed routes" value={String(apiAcceleratorStats.failed || 0)} />
              </Grid.Item>
            </Grid.Root>

            <Grid.Root gap={4}>
              <Grid.Item col={6} xs={12}>
                <TextField
                  label="Default query string"
                  hint="Example: populate=* or locale=en."
                  name="defaultQueryString"
                  value={apiAcceleratorSettings.defaultQueryString || ''}
                  onChange={(event) => updateApiAcceleratorField('defaultQueryString', event.target.value)}
                />
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <SelectField
                  label="Block public GET mode"
                  value={apiAcceleratorSettings.blockGetMode || 'no'}
                  onChange={(value) => updateApiAcceleratorField('blockGetMode', value)}
                >
                  <SingleSelectOption value="no">Do not block</SingleSelectOption>
                  <SingleSelectOption value="all">Block all public GET /api/*</SingleSelectOption>
                  <SingleSelectOption value="synced">Block only synced endpoints</SingleSelectOption>
                </SelectField>
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <SelectField
                  label="Collection page size"
                  value={String(apiAcceleratorSettings.collectionSyncPerPage || 50)}
                  onChange={(value) => updateApiAcceleratorField('collectionSyncPerPage', Number(value))}
                >
                  <SingleSelectOption value="10">10</SingleSelectOption>
                  <SingleSelectOption value="25">25</SingleSelectOption>
                  <SingleSelectOption value="50">50</SingleSelectOption>
                  <SingleSelectOption value="100">100</SingleSelectOption>
                </SelectField>
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <SelectField
                  label="Auto sync frequency"
                  value={apiAcceleratorSettings.autoSyncFrequency || 'hourly'}
                  onChange={(value) => updateApiAcceleratorField('autoSyncFrequency', value)}
                >
                  <SingleSelectOption value="hourly">Hourly</SingleSelectOption>
                  <SingleSelectOption value="daily">Daily</SingleSelectOption>
                  <SingleSelectOption value="weekly">Weekly</SingleSelectOption>
                  <SingleSelectOption value="off">Off</SingleSelectOption>
                </SelectField>
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <TextAreaField
                  label="Include content types"
                  hint="One UID per line or separated by commas."
                  name="includeContentTypes"
                  value={apiAcceleratorSettings.includeContentTypesText || ''}
                  onChange={(event) => updateApiAcceleratorField('includeContentTypesText', event.target.value)}
                />
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <TextAreaField
                  label="Manual routes"
                  hint="Additional /api/... routes outside the regular Content API."
                  name="manualRoutes"
                  value={apiAcceleratorSettings.manualRoutesText || ''}
                  onChange={(event) => updateApiAcceleratorField('manualRoutesText', event.target.value)}
                />
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <TextField
                  label="Debounce after content change (ms)"
                  name="debounceMs"
                  type="number"
                  value={String(apiAcceleratorSettings.debounceMs || 5000)}
                  onChange={(event) => updateApiAcceleratorField('debounceMs', Number(event.target.value || 5000))}
                />
              </Grid.Item>
              <Grid.Item col={6} xs={12}>
                <Field.Root hint="Upload generated JSON snapshots as protected assets." name="protectedAssets">
                  <Field.Label>Protected assets</Field.Label>
                  <Toggle
                    checked={Boolean(apiAcceleratorSettings.protectedAssets)}
                    offLabel="Disabled"
                    onLabel="Enabled"
                    onChange={(event) => updateApiAcceleratorField('protectedAssets', event.target.checked)}
                  />
                  <Field.Hint />
                </Field.Root>
              </Grid.Item>
            </Grid.Root>

            <Grid.Root gap={4}>
              <Grid.Item col={4} s={6} xs={12}>
                <MetricCard label="Last discovery" value={formatDateTime(apiAcceleratorSettings.lastDiscoveryAt)} />
              </Grid.Item>
              <Grid.Item col={4} s={6} xs={12}>
                <MetricCard label="Last sync" value={formatDateTime(apiAcceleratorSettings.lastSyncAt)} />
              </Grid.Item>
              <Grid.Item col={4} s={12} xs={12}>
                <MetricCard label="Last auto sync" value={formatDateTime(apiAcceleratorSettings.lastAutoSyncAt)} />
              </Grid.Item>
            </Grid.Root>

            <Flex direction="column" gap={3} alignItems="stretch">
              <Typography variant="delta" tag="h3">
                Discovered endpoints
              </Typography>
              {apiAcceleratorEndpoints.length === 0 ? (
                <Typography variant="pi" textColor="neutral600">
                  No endpoints have been discovered yet.
                </Typography>
              ) : (
                <Table colCount={6} rowCount={apiAcceleratorEndpoints.length + 1}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma" textColor="neutral600">
                          Route
                        </Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma" textColor="neutral600">
                          Kind
                        </Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma" textColor="neutral600">
                          Sync
                        </Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma" textColor="neutral600">
                          Status
                        </Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma" textColor="neutral600">
                          Last sync
                        </Typography>
                      </Th>
                      <Th>
                        <VisuallyHidden>Actions</VisuallyHidden>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {apiAcceleratorEndpoints.map((entry) => (
                      <Tr key={entry.id || entry.route}>
                        <Td>
                          <Typography textColor="neutral800">{entry.route || ''}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">{entry.kind || 'n/a'}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">
                            {entry.syncable ? 'Enabled' : 'Disabled'}
                          </Typography>
                        </Td>
                        <Td>
                          <Flex direction="column" gap={1} alignItems="stretch">
                            <Typography textColor="neutral800">
                              {entry.status || 'unknown'} / {entry.syncStatus || 'unknown'}
                            </Typography>
                            {entry.lastError ? (
                              <Typography variant="pi" textColor="danger600">
                                {entry.lastError}
                              </Typography>
                            ) : null}
                          </Flex>
                        </Td>
                        <Td>
                          <Typography textColor="neutral800">
                            {formatDateTime(entry.lastSyncedAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Flex gap={2} justifyContent="flex-end" wrap="wrap">
                            <Button
                              size="S"
                              variant="tertiary"
                              onClick={() => toggleSyncable(entry.route, !entry.syncable)}
                              disabled={isBusy || !apiAcceleratorModule?.enabled}
                            >
                              {entry.syncable ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              size="S"
                              variant="secondary"
                              onClick={() => syncRoute(entry.route)}
                              disabled={isBusy || !apiAcceleratorModule?.enabled}
                            >
                              Sync
                            </Button>
                            <Button
                              size="S"
                              variant="danger-light"
                              onClick={() => purgeRoute(entry.route)}
                              disabled={isBusy || !apiAcceleratorModule?.enabled}
                            >
                              Purge
                            </Button>
                          </Flex>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </Flex>
          </SectionCard>

          {placeholderModules.map((module) => (
            <SectionCard
              key={module.id}
              title={module.name}
              subtitle={module.description}
              badge={module.enabled ? 'Enabled' : 'Disabled'}
            >
              <Grid.Root gap={4}>
                <Grid.Item col={6} xs={12}>
                  <Box background="neutral100" hasRadius padding={5}>
                    <Flex direction="column" gap={3} alignItems="stretch">
                      <Typography variant="epsilon" tag="h3">
                        Runtime state
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        This module can already be enabled or disabled, but its runtime feature set is still a placeholder.
                      </Typography>
                      <Field.Root name={`placeholder-${module.id}`}>
                        <Toggle
                          checked={Boolean(module.enabled)}
                          disabled={isBusy}
                          offLabel="Disabled"
                          onLabel="Enabled"
                          onChange={(event) => toggleModule(module.id, event.target.checked)}
                        />
                      </Field.Root>
                    </Flex>
                  </Box>
                </Grid.Item>
                <Grid.Item col={6} xs={12}>
                  <Box background="neutral100" hasRadius padding={5}>
                    <Flex direction="column" gap={2} alignItems="stretch">
                      <Typography variant="epsilon" tag="h3">
                        Next implementation step
                      </Typography>
                      <Typography variant="pi" textColor="neutral600">
                        The module shell is already registered. The next pass can add dedicated settings,
                        controllers, services, and end-user UI without changing the core auth flow again.
                      </Typography>
                    </Flex>
                  </Box>
                </Grid.Item>
              </Grid.Root>
            </SectionCard>
          ))}
        </Flex>
      </Layouts.Content>
    </Page.Main>
  );
}
