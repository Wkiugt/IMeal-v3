import {
  containsMetricSensitiveText,
  METRIC_CONTRACT,
  type MetricContractRow,
  type MetricSampleEnvelope,
  type MetricSourceIdentity,
  type MetricUnit,
  validateMetricSampleEnvelope,
} from './metrics-contract.js';

type MetricLabels = Readonly<Record<string, string>>;
export type MetricLabelValues = MetricLabels;
export interface MetricSourceSnapshot {
  readonly source: MetricSourceIdentity;
  readonly samples: readonly MetricSampleEnvelope[];
}

type CounterSeries = {
  readonly type: 'counter';
  readonly labels: MetricLabels;
  value: number;
};

type GaugeSeries = {
  readonly type: 'gauge';
  readonly labels: MetricLabels;
  value: number;
};

type HistogramSeries = {
  readonly type: 'histogram';
  readonly labels: MetricLabels;
  readonly buckets: number[];
  sum: number;
  count: number;
};

type MetricSeries = CounterSeries | GaugeSeries | HistogramSeries;

type MetricState = {
  readonly row: MetricContractRow;
  readonly series: Map<string, MetricSeries>;
};

const METRIC_BY_NAME: ReadonlyMap<string, MetricContractRow> = new Map(
  METRIC_CONTRACT.map((row) => [row.name, row]),
);

const SOURCE_IDENTITIES: ReadonlySet<string> = new Set(
  METRIC_CONTRACT.map((row) => row.sourceIdentity),
);

const UNIT_VALUES: ReadonlySet<string> = new Set(
  METRIC_CONTRACT.map((row) => row.unit),
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Metric value must be finite');
  return Object.is(value, -0) ? '0' : String(value);
}

export function escapeMetricLabelValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/"/g, '\\"');
}

function labelsKey(labels: MetricLabels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key.length}:${key}=${labels[key].length}:${labels[key]}`)
    .join('|');
}

function sampleKey(sample: MetricSampleEnvelope): string {
  return `${sample.metricName}\u0000${labelsKey(sample.labels)}`;
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function samplesEqual(
  first: MetricSampleEnvelope,
  second: MetricSampleEnvelope,
): boolean {
  if (
    first.metricName !== second.metricName ||
    first.type !== second.type ||
    first.unit !== second.unit ||
    first.value !== second.value ||
    first.observedAt !== second.observedAt ||
    first.source !== second.source ||
    first.freshness !== second.freshness ||
    labelsKey(first.labels) !== labelsKey(second.labels)
  ) {
    return false;
  }
  const firstEvidence = first.evidence as unknown as Record<string, unknown>;
  const secondEvidence = second.evidence as unknown as Record<string, unknown>;
  const firstKeys = Object.keys(firstEvidence).sort();
  const secondKeys = Object.keys(secondEvidence).sort();
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every(
    (key, index) =>
      key === secondKeys[index] && firstEvidence[key] === secondEvidence[key],
  );
}

function sourceSnapshotEntries(
  snapshots: ReadonlyMap<
    MetricSourceIdentity,
    ReadonlyMap<string, MetricSampleEnvelope>
  >,
): MetricSampleEnvelope[] {
  const entries: MetricSampleEnvelope[] = [];
  for (const source of snapshots.values()) {
    for (const sample of source.values()) entries.push(sample);
  }
  return entries.sort((first, second) => {
    const firstKey = `${first.metricName}\u0000${labelsKey(first.labels)}\u0000${first.source}`;
    const secondKey = `${second.metricName}\u0000${labelsKey(second.labels)}\u0000${second.source}`;
    return compareStrings(firstKey, secondKey);
  });
}

function requireMetricName(metricName: string): MetricContractRow {
  const row = METRIC_BY_NAME.get(metricName);
  if (!row) throw new Error(`Metric name is not approved: ${metricName}`);
  return row;
}

function requireUnit(row: MetricContractRow, unit: unknown): void {
  if (unit === undefined) return;
  if (typeof unit !== 'string' || !UNIT_VALUES.has(unit) || unit !== row.unit) {
    throw new Error(`Metric unit does not match ${row.name}`);
  }
}

function requireApplicationMetric(row: MetricContractRow): void {
  if (row.sourceKind !== 'application') {
    throw new Error(
      `${row.name} is authoritative and must be supplied as a source snapshot`,
    );
  }
}

function requireLabels(row: MetricContractRow, value: unknown): MetricLabels {
  const labels = value === undefined ? {} : value;
  if (!isObject(labels))
    throw new Error(`Metric labels are not bounded for ${row.name}`);
  const expectedKeys = Object.keys(row.labels);
  const actualKeys = Object.keys(labels);
  if (
    expectedKeys.length !== actualKeys.length ||
    actualKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(row.labels, key),
    )
  ) {
    throw new Error(`Metric labels are not bounded for ${row.name}`);
  }
  const copy: Record<string, string> = {};
  for (const key of expectedKeys) {
    const labelValue = labels[key];
    if (
      typeof labelValue !== 'string' ||
      !row.labels[key].includes(labelValue) ||
      containsMetricSensitiveText(labelValue)
    ) {
      throw new Error(`Metric label ${key} is not approved for ${row.name}`);
    }
    copy[key] = labelValue;
  }
  return Object.freeze(copy);
}

function normalizeValue(row: MetricContractRow, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Metric value is invalid for ${row.name}`);
  }
  let normalized = value;
  if (row.valueSemantics.nonnegative && normalized < 0) {
    if (row.valueSemantics.negativeHandling === 'clamp_to_zero') {
      normalized = 0;
    } else {
      throw new Error(`Metric value must be nonnegative for ${row.name}`);
    }
  }
  if (
    row.valueSemantics.minimum !== undefined &&
    normalized < row.valueSemantics.minimum
  ) {
    throw new Error(`Metric value is below the minimum for ${row.name}`);
  }
  if (
    row.valueSemantics.maximum !== undefined &&
    normalized > row.valueSemantics.maximum
  ) {
    throw new Error(`Metric value is above the maximum for ${row.name}`);
  }
  return normalized;
}

function renderLabels(
  labels: MetricLabels,
  extra?: readonly [string, string],
): string {
  const pairs = Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeMetricLabelValue(labels[key])}"`);
  if (extra) pairs.push(`${extra[0]}="${escapeMetricLabelValue(extra[1])}"`);
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
}


export class MetricRegistry {
  private readonly metrics = new Map<string, MetricState>();
  private readonly sourceSnapshots = new Map<
    MetricSourceIdentity,
    Map<string, MetricSampleEnvelope>
  >();

  constructor() {
    for (const row of METRIC_CONTRACT) {
      this.metrics.set(row.name, { row, series: new Map() });
    }
  }

  increment(
    metricName: string,
    labels?: MetricLabels,
    amount?: number,
    unit?: MetricUnit,
  ): void;
  increment(
    metricName: string,
    unit: MetricUnit,
    labels?: MetricLabels,
    amount?: number,
  ): void;
  increment(
    metricName: string,
    labelsOrUnit?: MetricLabels | MetricUnit,
    amountOrLabels?: number | MetricLabels,
    unitOrAmount?: MetricUnit | number,
  ): void {
    const row = requireMetricName(metricName);
    requireApplicationMetric(row);
    let labelsInput: unknown = labelsOrUnit;
    let amountInput: unknown = amountOrLabels;
    let unitInput: unknown = unitOrAmount;
    if (typeof labelsOrUnit === 'string') {
      unitInput = labelsOrUnit;
      labelsInput = amountOrLabels;
      amountInput = unitOrAmount;
    }
    requireUnit(row, unitInput);
    if (row.type !== 'counter') {
      throw new Error(`${row.name} is not a counter`);
    }
    const labels = requireLabels(row, labelsInput);
    const amount = normalizeValue(
      row,
      amountInput === undefined ? 1 : amountInput,
    );
    const series = this.getOrCreateSeries(row, labels, 'counter');
    if (series.type !== 'counter')
      throw new Error(`Metric type changed for ${row.name}`);
    const next = series.value + amount;
    if (!Number.isFinite(next))
      throw new Error(`Metric counter overflow for ${row.name}`);
    series.value = next;
  }

  setGauge(
    metricName: string,
    labels?: MetricLabels,
    value?: number,
    unit?: MetricUnit,
  ): void;
  setGauge(
    metricName: string,
    unit: MetricUnit,
    labels?: MetricLabels,
    value?: number,
  ): void;
  setGauge(
    metricName: string,
    labelsOrUnit?: MetricLabels | MetricUnit,
    valueOrLabels?: number | MetricLabels,
    unitOrValue?: MetricUnit | number,
  ): void {
    const row = requireMetricName(metricName);
    requireApplicationMetric(row);
    let labelsInput: unknown = labelsOrUnit;
    let valueInput: unknown = valueOrLabels;
    let unitInput: unknown = unitOrValue;
    if (typeof labelsOrUnit === 'string') {
      unitInput = labelsOrUnit;
      labelsInput = valueOrLabels;
      valueInput = unitOrValue;
    }
    requireUnit(row, unitInput);
    if (row.type !== 'gauge') throw new Error(`${row.name} is not a gauge`);
    const labels = requireLabels(row, labelsInput);
    const value = normalizeValue(row, valueInput);
    const series = this.getOrCreateSeries(row, labels, 'gauge');
    if (series.type !== 'gauge')
      throw new Error(`Metric type changed for ${row.name}`);
    series.value = value;
  }

  observeHistogram(
    metricName: string,
    labels?: MetricLabels,
    value?: number,
    unit?: MetricUnit,
  ): void;
  observeHistogram(
    metricName: string,
    unit: MetricUnit,
    labels?: MetricLabels,
    value?: number,
  ): void;
  observeHistogram(
    metricName: string,
    labelsOrUnit?: MetricLabels | MetricUnit,
    valueOrLabels?: number | MetricLabels,
    unitOrValue?: MetricUnit | number,
  ): void {
    const row = requireMetricName(metricName);
    requireApplicationMetric(row);
    let labelsInput: unknown = labelsOrUnit;
    let valueInput: unknown = valueOrLabels;
    let unitInput: unknown = unitOrValue;
    if (typeof labelsOrUnit === 'string') {
      unitInput = labelsOrUnit;
      labelsInput = valueOrLabels;
      valueInput = unitOrValue;
    }
    requireUnit(row, unitInput);
    if (row.type !== 'histogram') {
      throw new Error(`${row.name} is not a histogram`);
    }
    const labels = requireLabels(row, labelsInput);
    const value = normalizeValue(row, valueInput);
    const series = this.getOrCreateSeries(row, labels, 'histogram');
    if (series.type !== 'histogram')
      throw new Error(`Metric type changed for ${row.name}`);
    for (let index = 0; index < row.buckets.length; index += 1) {
      if (value <= row.buckets[index]) series.buckets[index] += 1;
    }
    series.sum += value;
    series.count += 1;
  }

  mergeSourceSnapshot(snapshot: MetricSourceSnapshot): void {
    const incoming = this.validateSourceSnapshot(snapshot);
    const existing = this.sourceSnapshots.get(snapshot.source);
    const target = existing ?? new Map<string, MetricSampleEnvelope>();
    for (const [key, sample] of incoming) {
      const prior = target.get(key);
      if (prior && !samplesEqual(prior, sample)) {
        throw new Error(`Conflicting duplicate metric sample: ${key}`);
      }
    }
    if (!existing) this.sourceSnapshots.set(snapshot.source, target);
    for (const [key, sample] of incoming) target.set(key, sample);
  }

  replaceSourceSnapshot(snapshot: MetricSourceSnapshot): void {
    const incoming = this.validateSourceSnapshot(snapshot);
    const prior = this.sourceSnapshots.get(snapshot.source);
    if (prior) {
      for (const [key, sample] of incoming) {
        const previous = prior.get(key);
        if (
          previous &&
          sample.freshness !== 'fresh' &&
          sample.value === 0 &&
          !samplesEqual(previous, sample)
        ) {
          throw new Error(
            `Refusing to replace non-fresh metric sample with zero: ${key}`,
          );
        }
      }
    }
    this.sourceSnapshots.set(snapshot.source, incoming);
  }

  getSourceSnapshot(
    source: MetricSourceIdentity,
  ): readonly MetricSampleEnvelope[] {
    if (!SOURCE_IDENTITIES.has(source)) {
      throw new Error(`Metric source identity is not approved: ${source}`);
    }
    const snapshot = this.sourceSnapshots.get(source);
    return Object.freeze(
      snapshot
        ? [...snapshot.values()].sort((first, second) =>
            compareStrings(sampleKey(first), sampleKey(second)),
          )
        : [],
    );
  }

  getSourceSnapshots(): readonly MetricSourceSnapshot[] {
    const output: MetricSourceSnapshot[] = [];
    for (const source of SOURCE_IDENTITIES) {
      const typedSource = source as MetricSourceIdentity;
      const samples = this.sourceSnapshots.get(typedSource);
      if (samples) {
        output.push({
          source: typedSource,
          samples: this.getSourceSnapshot(typedSource),
        });
      }
    }
    return Object.freeze(output);
  }

  serialize(): string {
    const lines: string[] = [];
    const externalSamples = sourceSnapshotEntries(this.sourceSnapshots);
    for (const row of METRIC_CONTRACT) {
      const local = this.metrics.get(row.name);
      const localSeries = local ? [...local.series.values()] : [];
      const sourceSamples = externalSamples.filter(
        (sample) =>
          sample.metricName === row.name && sample.freshness === 'fresh',
      );
      if (localSeries.length === 0 && sourceSamples.length === 0) continue;
      lines.push(`# HELP ${row.familyName} ${row.source}`);
      lines.push(`# TYPE ${row.familyName} ${row.type}`);
      const renderedSeries = new Set<string>();
      for (const series of localSeries.sort((first, second) =>
        compareStrings(labelsKey(first.labels), labelsKey(second.labels)),
      )) {
        this.renderSeries(lines, row, series, renderedSeries);
      }
      for (const sample of sourceSamples) {
        const labels = requireLabels(row, sample.labels);
        const key = labelsKey(labels);
        if (renderedSeries.has(key)) {
          throw new Error(`Duplicate serialized metric series: ${row.name}`);
        }
        renderedSeries.add(key);
        if (row.type === 'histogram') {
          const histogram: HistogramSeries = {
            type: 'histogram',
            labels,
            buckets: row.buckets.map((bucket) =>
              sample.value <= bucket ? 1 : 0,
            ),
            sum: sample.value,
            count: 1,
          };
          this.renderSeries(lines, row, histogram, new Set());
        } else {
          lines.push(
            `${row.name}${renderLabels(labels)} ${formatNumber(sample.value)}`,
          );
        }
      }
    }
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  toPrometheusText(): string {
    return this.serialize();
  }

  private getOrCreateSeries(
    row: MetricContractRow,
    labels: MetricLabels,
    type: MetricSeries['type'],
  ): MetricSeries {
    const metric = this.metrics.get(row.name);
    if (!metric) throw new Error(`Metric is not registered: ${row.name}`);
    const key = labelsKey(labels);
    const current = metric.series.get(key);
    if (current) {
      if (current.type !== type)
        throw new Error(`Metric type changed for ${row.name}`);
      return current;
    }
    const maximumSeries =
      row.cardinalityBudget === 0 ? 1 : row.cardinalityBudget;
    if (metric.series.size >= maximumSeries) {
      throw new Error(`Metric cardinality budget exceeded for ${row.name}`);
    }
    let series: MetricSeries;
    if (type === 'counter') {
      series = { type, labels, value: 0 };
    } else if (type === 'gauge') {
      series = { type, labels, value: 0 };
    } else {
      series = {
        type,
        labels,
        buckets: row.buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
    }
    metric.series.set(key, series);
    return series;
  }

  private renderSeries(
    lines: string[],
    row: MetricContractRow,
    series: MetricSeries,
    renderedSeries: Set<string>,
  ): void {
    const key = labelsKey(series.labels);
    if (renderedSeries.has(key)) {
      throw new Error(`Duplicate serialized metric series: ${row.name}`);
    }
    renderedSeries.add(key);
    if (series.type === 'counter' || series.type === 'gauge') {
      lines.push(
        `${row.name}${renderLabels(series.labels)} ${formatNumber(series.value)}`,
      );
      return;
    }
    for (let index = 0; index < row.buckets.length; index += 1) {
      const bucket = row.buckets[index];
      const label = bucket === Infinity ? '+Inf' : formatNumber(bucket);
      lines.push(
        `${row.familyName}_bucket${renderLabels(series.labels, ['le', label])} ${formatNumber(series.buckets[index])}`,
      );
    }
    lines.push(
      `${row.familyName}_sum${renderLabels(series.labels)} ${formatNumber(series.sum)}`,
    );
    lines.push(
      `${row.familyName}_count${renderLabels(series.labels)} ${formatNumber(series.count)}`,
    );
  }

  private validateSourceSnapshot(
    snapshot: MetricSourceSnapshot,
  ): Map<string, MetricSampleEnvelope> {
    if (!isObject(snapshot) || !SOURCE_IDENTITIES.has(snapshot.source)) {
      throw new Error('Metric source snapshot identity is not approved');
    }
    if (!Array.isArray(snapshot.samples)) {
      throw new Error('Metric source snapshot samples are required');
    }
    const validated = new Map<string, MetricSampleEnvelope>();
    for (const candidate of snapshot.samples) {
      const sample = validateMetricSampleEnvelope(candidate);
      if (sample.source !== snapshot.source) {
        throw new Error(
          'Metric source snapshot identity does not match sample',
        );
      }
      const key = sampleKey(sample);
      const prior = validated.get(key);
      if (prior && !samplesEqual(prior, sample)) {
        throw new Error(`Conflicting duplicate metric sample: ${key}`);
      }
      validated.set(key, sample);
    }
    return validated;
  }
}

export function createMetricRegistry(): MetricRegistry {
  return new MetricRegistry();
}

export function serializeOpenMetrics(registry: MetricRegistry): string {
  return registry.serialize();
}

export function serializeMetrics(registry: MetricRegistry): string {
  return registry.serialize();
}
