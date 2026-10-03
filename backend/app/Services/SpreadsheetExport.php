<?php

namespace App\Services;

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Excel (.xlsx) downloads. Real .xlsx rather than CSV, because Excel with Indonesian
 * regional settings expects ";" in CSV files and would open a comma CSV as one column.
 */
class SpreadsheetExport
{
    /**
     * @param  array<string, array{0: list<string>, 1: iterable<array>}>  $sheets  sheet name => [header row, data rows]
     */
    public function download(string $fileName, array $sheets): BinaryFileResponse
    {
        $path = tempnam(sys_get_temp_dir(), 'xlsx');
        $writer = new Writer;
        $writer->openToFile($path);
        $bold = new Style(fontBold: true);

        foreach (array_keys($sheets) as $index => $name) {
            [$header, $rows] = $sheets[$name];
            $sheet = $index === 0 ? $writer->getCurrentSheet() : $writer->addNewSheetAndMakeItCurrent();
            $sheet->setName($name);

            $writer->addRow($this->row($header, $bold));
            foreach ($rows as $row) {
                $writer->addRow($this->row($row));
            }
        }

        $writer->close();

        return response()->download($path, $fileName, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend();
    }

    /**
     * Text always stays text: OpenSpout would otherwise turn a value starting with "=" (e.g. a
     * host's name or a typed reason) into a formula that runs when the file is opened.
     */
    private function row(array $values, ?Style $style = null): Row
    {
        return new Row(array_map(
            fn ($value) => is_string($value) && $value !== '' ? new StringCell($value, $style) : Cell::fromValue($value, $style),
            array_values($values),
        ));
    }
}
