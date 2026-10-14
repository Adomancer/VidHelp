<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use OpenSpout\Reader\XLSX\Reader;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Tests must never reach real services (Discord, Google); fake what a test needs
        Http::preventStrayRequests();
    }

    /**
     * Read an Excel download back: sheet name => rows of cell values (header row first).
     *
     * @return array<string, list<list<mixed>>>
     */
    protected function xlsxSheets(TestResponse $response): array
    {
        $path = $response->baseResponse->getFile()->getPathname();
        $reader = new Reader;
        $reader->open($path);

        $sheets = [];
        foreach ($reader->getSheetIterator() as $sheet) {
            foreach ($sheet->getRowIterator() as $row) {
                $sheets[$sheet->getName()][] = array_map($this->xlsxHours(...), $row->toArray());
            }
        }

        $reader->close();
        unlink($path);

        return $sheets;
    }

    /**
     * Hour cells ("8 jam") use Excel's General format, whose "e" OpenSpout's reader mistakes for
     * a date code: it returns a day in 1899/1900. Turn those back into the number of hours.
     */
    private function xlsxHours(mixed $value): mixed
    {
        if (! $value instanceof \DateTimeInterface || (int) $value->format('Y') > 1900) {
            return $value;
        }

        $base = new \DateTimeImmutable('1899-12-30 00:00:00', $value->getTimezone());
        $hours = round(($value->getTimestamp() - $base->getTimestamp()) / 86400, 4);

        return floor($hours) == $hours ? (int) $hours : $hours;
    }

    /**
     * One table of a report sheet: its header row (the one starting with `$firstHeader`) and the
     * data rows under it, without the TOTAL row.
     *
     * @param  list<list<mixed>>  $rows
     * @return list<list<mixed>>
     */
    protected function xlsxTable(array $rows, string $firstHeader): array
    {
        $start = collect($rows)->search(fn (array $row) => ($row[0] ?? null) === $firstHeader);
        $this->assertNotFalse($start, "No table starting with \"{$firstHeader}\".");

        $table = [];
        foreach (array_slice($rows, $start) as $i => $row) {
            if ($i > 0 && is_string($row[0] ?? null) && str_starts_with($row[0], 'TOTAL')) {
                break;
            }
            $table[] = $row;
        }

        return $table;
    }

    /**
     * The value next to a label in a report's key figures (e.g. "Total jam" → 12.5).
     *
     * @param  list<list<mixed>>  $rows
     */
    protected function xlsxValue(array $rows, string $label): mixed
    {
        $row = collect($rows)->first(fn (array $row) => ($row[0] ?? null) === $label);
        $this->assertNotNull($row, "No line \"{$label}\".");

        return $row[1];
    }
}
