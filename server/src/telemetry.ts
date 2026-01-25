import { metrics, ValueType } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

/**
 * Telemetry service for pushing metrics to Grafana Cloud
 */
export class Telemetry {
  private static instance: Telemetry;
  private meterProvider: MeterProvider | null = null;
  private connectionsCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
  private disconnectionsCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
  private authenticationsCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
  private suggestionsCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
  private activeConnectionsGauge: ReturnType<ReturnType<typeof metrics.getMeter>['createUpDownCounter']> | null = null;
  private enabled = false;

  private constructor() {}

  static getInstance(): Telemetry {
    if (!Telemetry.instance) {
      Telemetry.instance = new Telemetry();
    }
    return Telemetry.instance;
  }

  /**
   * Initialize OpenTelemetry with Grafana Cloud credentials
   */
  init(): void {
    const instanceId = process.env.GRAFANA_INSTANCE_ID;
    const apiKey = process.env.GRAFANA_API_KEY;
    const remoteWriteUrl = process.env.GRAFANA_REMOTE_WRITE_URL;

    if (!instanceId || !apiKey || !remoteWriteUrl) {
      console.log('[Telemetry] Grafana credentials not configured, metrics disabled');
      return;
    }

    // Convert Prometheus remote_write URL to OTLP endpoint
    // From: https://prometheus-prod-24-prod-eu-west-2.grafana.net/api/prom/push
    // To: https://otlp-gateway-prod-eu-west-2.grafana.net/otlp/v1/metrics
    const region = remoteWriteUrl.match(/prod-(\w+-\w+-\d+)/)?.[1] || 'eu-west-2';
    const otlpUrl = `https://otlp-gateway-prod-${region}.grafana.net/otlp/v1/metrics`;

    const authHeader = Buffer.from(`${instanceId}:${apiKey}`).toString('base64');

    const exporter = new OTLPMetricExporter({
      url: otlpUrl,
      headers: {
        'Authorization': `Basic ${authHeader}`,
      },
    });

    // Add error handling for the exporter
    const originalExport = exporter.export.bind(exporter);
    exporter.export = (metrics, resultCallback) => {
      return originalExport(metrics, (result) => {
        if (result.code !== 0) {
          console.error('[Telemetry] Export failed:', result.error?.message || 'Unknown error');
        } else {
          console.log('[Telemetry] Metrics exported successfully');
        }
        resultCallback(result);
      });
    };

    const metricReader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000, // Export every 60 seconds
    });

    this.meterProvider = new MeterProvider({
      readers: [metricReader],
    });

    metrics.setGlobalMeterProvider(this.meterProvider);

    const meter = metrics.getMeter('chessr-server', '1.0.0');

    // Create metrics instruments
    this.connectionsCounter = meter.createCounter('chessr_connections_total', {
      description: 'Total number of WebSocket connections',
      valueType: ValueType.INT,
    });

    this.disconnectionsCounter = meter.createCounter('chessr_disconnections_total', {
      description: 'Total number of WebSocket disconnections',
      valueType: ValueType.INT,
    });

    this.suggestionsCounter = meter.createCounter('chessr_suggestions_total', {
      description: 'Total number of suggestions served',
      valueType: ValueType.INT,
    });

    this.authenticationsCounter = meter.createCounter('chessr_authentications_total', {
      description: 'Total number of successful authentications',
      valueType: ValueType.INT,
    });

    this.activeConnectionsGauge = meter.createUpDownCounter('chessr_active_connections', {
      description: 'Number of active WebSocket connections',
      valueType: ValueType.INT,
    });

    this.enabled = true;
    console.log(`[Telemetry] Initialized, pushing to ${otlpUrl}`);
  }

  /**
   * Record a new connection
   */
  recordConnection(): void {
    if (!this.enabled) return;
    this.connectionsCounter?.add(1);
    this.activeConnectionsGauge?.add(1);
  }

  /**
   * Record a disconnection
   */
  recordDisconnection(): void {
    if (!this.enabled) return;
    this.disconnectionsCounter?.add(1);
    this.activeConnectionsGauge?.add(-1);
  }

  /**
   * Record a successful authentication
   */
  recordAuthentication(): void {
    if (!this.enabled) return;
    this.authenticationsCounter?.add(1);
  }

  /**
   * Record a suggestion served
   */
  recordSuggestion(depth: number = 0): void {
    if (!this.enabled) return;
    this.suggestionsCounter?.add(1, { depth: String(depth) });
  }

  /**
   * Shutdown telemetry gracefully
   */
  async shutdown(): Promise<void> {
    if (this.meterProvider) {
      await this.meterProvider.shutdown();
    }
  }
}

export const telemetry = Telemetry.getInstance();
