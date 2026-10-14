<?php

namespace App\Services\Excel;

/**
 * One sheet of a report, built from blocks written top to bottom: key figures ("pairs"),
 * tables and notes. A sheet whose first block is a table keeps that table's header in view
 * while scrolling and gets filter buttons on it.
 */
final class ExcelSheet
{
    /** @var list<array<string, mixed>> */
    public array $blocks = [];

    public function __construct(
        public readonly string $name,
        public readonly ?string $description = null,
    ) {}

    /**
     * Label/value lines under a heading, e.g. ['Total jam', 42.5, 'hours'].
     *
     * @param  list<array{0: string, 1: mixed, 2?: string}>  $rows
     */
    public function pairs(string $heading, array $rows): self
    {
        $this->blocks[] = ['kind' => 'pairs', 'heading' => $heading, 'rows' => $rows];

        return $this;
    }

    /**
     * @param  list<Column>  $columns
     * @param  iterable<array<int, mixed>>  $rows  values in column order
     * @param  bool  $totals  add a TOTAL row summing the number-like columns (follows the filter)
     */
    public function table(array $columns, iterable $rows, ?string $heading = null, bool $totals = false, string $empty = 'Tidak ada data untuk filter ini.'): self
    {
        $this->blocks[] = [
            'kind' => 'table',
            'heading' => $heading,
            'columns' => array_values($columns),
            'rows' => collect($rows)->map(fn ($row) => array_values((array) $row))->all(),
            'totals' => $totals,
            'empty' => $empty,
        ];

        return $this;
    }

    public function note(string $text): self
    {
        $this->blocks[] = ['kind' => 'note', 'text' => $text];

        return $this;
    }

    /** Widest block, in columns (at least 2 for label/value lines). */
    public function columnCount(): int
    {
        $count = 2;
        foreach ($this->blocks as $block) {
            if ($block['kind'] === 'table') {
                $count = max($count, count($block['columns']));
            }
        }

        return $count;
    }
}
