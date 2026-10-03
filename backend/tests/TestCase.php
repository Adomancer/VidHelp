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
                $sheets[$sheet->getName()][] = $row->toArray();
            }
        }

        $reader->close();
        unlink($path);

        return $sheets;
    }
}
