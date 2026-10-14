<?php

namespace Tests\Feature;

use App\Services\Excel\Column;
use App\Services\Excel\ExcelReport;
use DOMDocument;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;
use ZipArchive;

class ExcelReportTest extends TestCase
{
    public function test_titles_and_names_with_xml_characters_still_make_a_valid_file(): void
    {
        $report = new ExcelReport('Laporan Poin & SP <Uji>', 'Brand "A&B"', 'O\'Neil & Co');
        $report->sheet('Ringkasan')->pairs('Angka', [['Total', 12, 'number']]);
        $report->sheet('Data')->table([Column::text('Nama'), Column::rupiah('Gaji')], [['Budi & Ani', 1000]], totals: true);

        $path = $report->download('uji.xlsx')->getFile()->getPathname();
        $zip = new ZipArchive;
        $zip->open($path);

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (str_ends_with($name, '.xml') || str_ends_with($name, '.rels')) {
                $this->assertTrue((new DOMDocument)->loadXML($zip->getFromIndex($i)), "{$name} is not valid XML");
            }
        }
        $this->assertStringContainsString('Laporan Poin &amp; SP &lt;Uji&gt;', $zip->getFromName('docProps/core.xml'));
        $zip->close();
        unlink($path);
    }

    public function test_tables_have_a_title_a_header_and_a_total_that_follows_the_filter(): void
    {
        $report = new ExcelReport('Laporan Uji', 'Oktober 2026');
        $report->sheet('Data')->table([Column::text('Nama'), Column::hours('Jam'), Column::rupiah('Gaji')], [['A', 1.5, 1000], ['B', 2, 2500]], totals: true);

        $rows = $this->xlsxSheets(TestResponse::fromBaseResponse($report->download('uji.xlsx')))['Data'];

        $this->assertSame('Laporan Uji', $rows[0][0]);
        $this->assertStringContainsString('Oktober 2026', $rows[1][0]);
        $this->assertSame(['Nama', 'Jam', 'Gaji'], $rows[2]);
        $this->assertSame(['TOTAL (2 baris)', '=SUBTOTAL(109,B5:B6)', '=SUBTOTAL(109,C5:C6)'], $rows[5]);
    }
}
