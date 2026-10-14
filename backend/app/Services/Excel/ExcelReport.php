<?php

namespace App\Services\Excel;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\DateTimeCell;
use OpenSpout\Common\Entity\Cell\EmptyCell;
use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Common\Entity\Cell\NumericCell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Border;
use OpenSpout\Common\Entity\Style\BorderName;
use OpenSpout\Common\Entity\Style\BorderPart;
use OpenSpout\Common\Entity\Style\BorderStyle;
use OpenSpout\Common\Entity\Style\BorderWidth;
use OpenSpout\Common\Entity\Style\CellAlignment;
use OpenSpout\Common\Entity\Style\CellVerticalAlignment;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\AutoFilter;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Options;
use OpenSpout\Writer\XLSX\Options\HeaderFooter;
use OpenSpout\Writer\XLSX\Options\PageOrientation;
use OpenSpout\Writer\XLSX\Options\PageSetup;
use OpenSpout\Writer\XLSX\Options\PaperSize;
use OpenSpout\Writer\XLSX\Properties;
use OpenSpout\Writer\XLSX\Writer;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * A styled Excel report: every sheet starts with the report title and what it covers,
 * tables have a colored header that stays in view, banded rows, Rupiah/hour/date formats,
 * filters and a TOTAL row. Prints landscape on A4, one page wide.
 *
 *     $report = new ExcelReport('Laporan Host', 'Semua brand');
 *     $report->sheet('Ringkasan')->pairs('Jumlah', [['Host aktif', 12, 'number']]);
 *     $report->sheet('Host')->table([Column::text('Nama', 24), Column::rupiah('Tarif/jam')], $rows, totals: true);
 *     return $report->download('host.xlsx');
 *
 * Text is always written as text, so a name starting with "=" never becomes a formula.
 */
final class ExcelReport
{
    /** Status label backgrounds. */
    public const TONES = [
        'green' => 'DCFCE7',
        'amber' => 'FEF3C7',
        'red' => 'FEE2E2',
        'blue' => 'DBEAFE',
        'violet' => 'E8E7FD',
        'gray' => 'EEF1F5',
    ];

    private const BRAND = '5750F1';

    private const INK = '111928';

    private const MUTED = '64748B';

    private const LINE = 'E3E8EF';

    private const BAND = 'F7F8FC';

    private const TOTAL_FILL = 'ECEBFE';

    private const FORMATS = [
        'number' => '#,##0',
        'decimal' => '#,##0.0',
        'rupiah' => '"Rp "#,##0',
        // "8 jam", "2,5 jam": no trailing zeros, still a number (totals and filters keep working)
        'hours' => 'General" jam"',
        // [$-421] = Indonesian month names ("17 Agu 2026") whatever language Excel runs in
        'date' => '[$-421]dd mmm yyyy',
        'datetime' => '[$-421]dd mmm yyyy hh:mm',
    ];

    /** @var list<ExcelSheet> */
    private array $sheets = [];

    /** @var array<string, Style> */
    private array $styles = [];

    /**
     * @param  string  $title  e.g. "Laporan Keuangan"
     * @param  ?string  $scope  what the report covers, e.g. "1–31 Oktober 2026 · Brand A"
     */
    public function __construct(
        private readonly string $title,
        private readonly ?string $scope = null,
        private readonly ?string $author = null,
    ) {}

    public function sheet(string $name, ?string $description = null): ExcelSheet
    {
        return $this->sheets[] = new ExcelSheet($this->sheetName($name), $description);
    }

    public function download(string $fileName): BinaryFileResponse
    {
        $path = tempnam(sys_get_temp_dir(), 'xlsx');
        $options = new Options(
            FALLBACK_STYLE: new Style(fontSize: 10, fontName: 'Calibri'),
            pageSetup: new PageSetup(PageOrientation::LANDSCAPE, PaperSize::A4, fitToHeight: 0, fitToWidth: 1),
            headerFooter: new HeaderFooter(oddFooter: $this->footer()),
            // OpenSpout writes these into docProps/core.xml as is: "Poin & SP" would break the file
            properties: new Properties(
                title: $this->xml($this->title),
                subject: $this->scope === null ? null : $this->xml($this->scope),
                application: 'VidHelp',
                creator: $this->xml($this->author ?? 'VidHelp'),
                lastModifiedBy: $this->xml($this->author ?? 'VidHelp'),
            ),
        );
        $writer = new Writer($options);
        $writer->openToFile($path);

        foreach ($this->sheets as $index => $sheet) {
            $this->writeSheet($writer, $options, $sheet, $index);
        }

        $writer->close();

        return response()->download($path, $fileName, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])->deleteFileAfterSend();
    }

    private function writeSheet(Writer $writer, Options $options, ExcelSheet $sheet, int $index): void
    {
        $target = $index === 0 ? $writer->getCurrentSheet() : $writer->addNewSheetAndMakeItCurrent();
        $target->setName($sheet->name);
        $columns = $sheet->columnCount();
        $last = $columns - 1;

        foreach ($this->widths($sheet) as $column => $width) {
            $target->setColumnWidth($width, $column + 1);
        }

        // A sheet that is one table keeps its header in view (title, scope, blank, [heading], header)
        $first = $sheet->blocks[0] ?? null;
        $mainTable = $first && $first['kind'] === 'table' ? $first : null;
        $headerRow = $mainTable ? 4 + ($mainTable['heading'] ? 1 : 0) : null;
        $target->setSheetView(new SheetView(
            showGridLines: false,
            tabSelected: $index === 0,
            freezeRow: $headerRow ? $headerRow + 1 : 0,
        ));

        $row = 0;
        $add = function (array $cells, float $height = 18) use ($writer, &$row) {
            $writer->addRow(new Row($cells, $height));
            $row++;
        };

        // Title, what the report covers, and when it was made
        $add($this->line($this->text($this->title, 'title'), $columns), 30);
        $options->mergeCells(0, $row, $last, $row, $index);
        $scope = collect([$sheet->description, $this->scope, 'Dibuat '.now()->locale('id')->translatedFormat('j F Y H:i').($this->author ? " oleh {$this->author}" : '')])
            ->filter()->implode(' · ');
        $add($this->line($this->text($scope, 'scope'), $columns));
        $options->mergeCells(0, $row, $last, $row, $index);
        $add([], 10);

        foreach ($sheet->blocks as $position => $block) {
            if ($position > 0) {
                $add([], 10);
            }

            match ($block['kind']) {
                'pairs' => $this->writePairs($block, $columns, $add, $options, $index, $row),
                'table' => $this->writeTable($block, $columns, $add, $options, $index, $row, $target, $block === $mainTable),
                'note' => $this->writeNote($block, $columns, $add, $options, $index, $row),
            };
        }
    }

    private function writePairs(array $block, int $columns, callable $add, Options $options, int $index, int &$row): void
    {
        $add($this->line($this->text($block['heading'], 'heading'), $columns, 'heading'), 22);
        $options->mergeCells(0, $row, $columns - 1, $row, $index);

        foreach ($block['rows'] as $pair) {
            [$label, $value] = $pair;
            $type = $pair[2] ?? 'text';
            $add([
                $this->text($label, 'label'),
                $this->value($value, $type, $this->style('pair', $type)),
            ], 20);
        }
    }

    private function writeTable(array $block, int $columns, callable $add, Options $options, int $index, int &$row, $target, bool $main): void
    {
        /** @var list<Column> $cols */
        $cols = $block['columns'];
        $width = count($cols);

        if ($block['heading']) {
            $add($this->line($this->text($block['heading'], 'heading'), $columns, 'heading'), 22);
            $options->mergeCells(0, $row, max(1, $width - 1), $row, $index);
        }

        $add(array_map(fn (Column $column) => $this->text($column->label, 'header'), $cols), 30);
        $headerRow = $row;

        if ($block['rows'] === []) {
            $add($this->line($this->text($block['empty'], 'empty'), $width, 'empty'), 22);
            $options->mergeCells(0, $row, max(1, $width - 1), $row, $index);

            return;
        }

        $sums = array_fill(0, $width, 0.0);
        foreach ($block['rows'] as $number => $values) {
            $band = $number % 2 === 1;
            $cells = [];
            foreach ($cols as $i => $column) {
                $value = $values[$i] ?? null;
                $fill = $column->tone && $value !== null ? ($column->tone)($value) : null;
                $style = $this->style('cell', $column->type, $fill ?? ($band ? self::BAND : null), $column->wrap, $fill !== null);
                $cells[] = $this->value($value, $column->type, $style);
                if ($column->summed && is_numeric($value)) {
                    $sums[$i] += (float) $value;
                }
            }
            $add($cells, $this->rowHeight($cols, $values));
        }
        $lastDataRow = $row;

        if ($main) {
            $target->setAutoFilter(new AutoFilter(0, $headerRow, $width - 1, $lastDataRow));
        }

        if ($block['totals']) {
            $cells = [];
            foreach ($cols as $i => $column) {
                if ($i === 0) {
                    $cells[] = new StringCell('TOTAL ('.count($block['rows']).' baris)', $this->style('total', 'text'));
                } elseif ($column->summed) {
                    // SUBTOTAL(109) adds up only the rows the filter shows
                    $letter = $this->columnLetter($i);
                    $cells[] = new FormulaCell("=SUBTOTAL(109,{$letter}".($headerRow + 1).":{$letter}{$lastDataRow})", round($sums[$i], 2), $this->style('total', $column->type));
                } else {
                    $cells[] = new EmptyCell(null, $this->style('total', 'text'));
                }
            }
            $add($cells, 22);
        }
    }

    private function writeNote(array $block, int $columns, callable $add, Options $options, int $index, int &$row): void
    {
        $add($this->line($this->text($block['text'], 'note'), $columns), 30);
        $options->mergeCells(0, $row, $columns - 1, $row, $index);
    }

    /** A cell followed by empty cells in the same style up to `$columns` (for merged lines). */
    private function line(Cell $first, int $columns, ?string $fill = null): array
    {
        return [$first, ...array_fill(0, max(0, $columns - 1), new EmptyCell(null, $fill ? $this->style($fill, 'text') : null))];
    }

    private function text(string $value, string $kind): StringCell
    {
        return new StringCell($value, $this->style($kind, 'text'));
    }

    private function value(mixed $value, string $type, Style $style): Cell
    {
        if ($value === null || $value === '') {
            return new EmptyCell(null, $style);
        }

        return match ($type) {
            'number', 'decimal', 'rupiah', 'hours' => is_numeric($value) ? new NumericCell($value + 0, $style) : new StringCell((string) $value, $style),
            'date', 'datetime' => new DateTimeCell($value instanceof DateTimeInterface ? $value : CarbonImmutable::parse($value), $style),
            default => new StringCell(is_bool($value) ? ($value ? 'Ya' : 'Tidak') : (string) $value, $style),
        };
    }

    /** Taller rows for wrapped long text. */
    private function rowHeight(array $columns, array $values): float
    {
        $lines = 1;
        foreach ($columns as $i => $column) {
            if ($column->wrap && is_string($values[$i] ?? null)) {
                $lines = max($lines, (int) ceil(mb_strlen($values[$i]) / max(8, $column->width * 1.1)));
            }
        }

        return min(80, 18 + ($lines - 1) * 13);
    }

    /** @return array<int, float> */
    private function widths(ExcelSheet $sheet): array
    {
        $widths = [];
        foreach ($sheet->blocks as $block) {
            if ($block['kind'] === 'table') {
                foreach ($block['columns'] as $i => $column) {
                    // Room for the longest word of the (bold) header plus the filter button
                    $longestWord = max(array_map('mb_strlen', explode(' ', $column->label)));
                    $widths[$i] = max($widths[$i] ?? 0, $column->width, ceil($longestWord * 1.2) + 5);

                    // ...and for the TOTAL, which is longer than any one row
                    if ($block['totals'] && $column->summed) {
                        $total = array_sum(array_map(fn (array $row) => is_numeric($row[$i] ?? null) ? (float) $row[$i] : 0, $block['rows']));
                        $digits = mb_strlen(number_format(abs($total), in_array($column->type, ['hours', 'decimal'], true) ? 2 : 0, ',', '.'));
                        $widths[$i] = max($widths[$i], $digits + ($column->type === 'rupiah' ? 6 : 3));
                    }
                }
            }
            if ($block['kind'] === 'pairs') {
                $longestLabel = max(array_map(fn (array $pair) => mb_strlen($pair[0]), $block['rows']));
                $widths[0] = max($widths[0] ?? 0, min(48, $longestLabel + 3));
                $widths[1] = max($widths[1] ?? 0, 22);
            }
        }

        return $widths;
    }

    private function style(string $kind, string $type, ?string $fill = null, bool $wrap = false, bool $toned = false): Style
    {
        $key = implode('|', [$kind, $type, $fill, $wrap, $toned]);
        if (isset($this->styles[$key])) {
            return $this->styles[$key];
        }

        $line = fn (string $color, BorderWidth $width = BorderWidth::THIN) => new Border(
            new BorderPart(BorderName::BOTTOM, $color, $width, BorderStyle::SOLID),
        );
        $grid = new Border(
            new BorderPart(BorderName::TOP, self::LINE, BorderWidth::THIN),
            new BorderPart(BorderName::RIGHT, self::LINE, BorderWidth::THIN),
            new BorderPart(BorderName::BOTTOM, self::LINE, BorderWidth::THIN),
            new BorderPart(BorderName::LEFT, self::LINE, BorderWidth::THIN),
        );
        $numeric = in_array($type, ['number', 'decimal', 'rupiah', 'hours'], true);
        $alignment = match (true) {
            $numeric => CellAlignment::RIGHT,
            in_array($type, ['date', 'datetime', 'time'], true), $toned => CellAlignment::CENTER,
            default => CellAlignment::LEFT,
        };

        $style = match ($kind) {
            'title' => new Style(fontBold: true, fontSize: 16, fontColor: self::INK, cellVerticalAlignment: CellVerticalAlignment::CENTER),
            'scope' => new Style(fontItalic: true, fontSize: 9, fontColor: self::MUTED),
            'heading' => new Style(fontBold: true, fontSize: 11, fontColor: self::BRAND, cellVerticalAlignment: CellVerticalAlignment::BOTTOM, border: $line(self::BRAND, BorderWidth::MEDIUM)),
            'header' => new Style(
                fontBold: true, fontColor: 'FFFFFF', cellAlignment: CellAlignment::CENTER, cellVerticalAlignment: CellVerticalAlignment::CENTER,
                shouldWrapText: true, border: new Border(...array_map(fn ($side) => new BorderPart($side, '4A43DE', BorderWidth::THIN), BorderName::cases())),
                backgroundColor: self::BRAND,
            ),
            'label' => new Style(fontColor: self::MUTED, cellVerticalAlignment: CellVerticalAlignment::CENTER, border: $line(self::LINE)),
            'pair' => new Style(fontBold: true, fontColor: self::INK, cellAlignment: $numeric ? CellAlignment::RIGHT : CellAlignment::LEFT, cellVerticalAlignment: CellVerticalAlignment::CENTER, border: $line(self::LINE), format: self::FORMATS[$type] ?? null),
            'cell' => new Style(
                fontColor: self::INK, cellAlignment: $alignment, cellVerticalAlignment: CellVerticalAlignment::CENTER, shouldWrapText: $wrap ?: null,
                border: $grid, backgroundColor: $fill, format: self::FORMATS[$type] ?? null,
            ),
            'total' => new Style(
                fontBold: true, fontColor: self::INK, cellAlignment: $numeric ? CellAlignment::RIGHT : CellAlignment::LEFT, cellVerticalAlignment: CellVerticalAlignment::CENTER,
                border: new Border(new BorderPart(BorderName::TOP, self::BRAND, BorderWidth::MEDIUM), new BorderPart(BorderName::BOTTOM, self::BRAND, BorderWidth::MEDIUM)),
                backgroundColor: self::TOTAL_FILL, format: self::FORMATS[$type] ?? null,
            ),
            'empty' => new Style(fontItalic: true, fontColor: self::MUTED, cellAlignment: CellAlignment::CENTER, border: $grid),
            'note' => new Style(fontItalic: true, fontSize: 9, fontColor: self::MUTED, shouldWrapText: true, cellVerticalAlignment: CellVerticalAlignment::TOP),
        };

        return $this->styles[$key] = $style;
    }

    /** 0 → A, 26 → AA */
    private function columnLetter(int $index): string
    {
        $letters = '';
        for ($index++; $index > 0; $index = intdiv($index - 1, 26)) {
            $letters = chr(65 + ($index - 1) % 26).$letters;
        }

        return $letters;
    }

    /** Excel sheet names: at most 31 characters, none of []:*?/\, and unique. */
    private function sheetName(string $name): string
    {
        $base = mb_substr(trim(preg_replace('/[\[\]:*?\/\\\\]/', '-', $name)), 0, 31) ?: 'Sheet';
        $taken = array_map(fn (ExcelSheet $sheet) => mb_strtolower($sheet->name), $this->sheets);
        $candidate = $base;
        for ($n = 2; in_array(mb_strtolower($candidate), $taken, true); $n++) {
            $candidate = mb_substr($base, 0, 28)." ({$n})";
        }

        return $candidate;
    }

    private function xml(string $text): string
    {
        return htmlspecialchars($text, ENT_XML1 | ENT_QUOTES);
    }

    /**
     * "VidHelp · title" on the left, "Halaman 1 dari 3" on the right. OpenSpout puts it in the
     * sheet XML as is, so it is XML-escaped here; "&&" is a literal "&" for Excel.
     */
    private function footer(): string
    {
        $title = str_replace('&', '&&', $this->title);

        return $this->xml("&L&8VidHelp · {$title}&R&8Halaman &P dari &N");
    }
}
