<?php

namespace App\Services\Excel;

use Closure;

/**
 * One column of a report table: its header, how values are shown, and how wide it is.
 * Number-like columns (number, rupiah, hours) are summed in the table's total row.
 */
final class Column
{
    /**
     * @param  'text'|'number'|'decimal'|'rupiah'|'hours'|'date'|'datetime'|'time'  $type
     * @param  ?Closure(mixed): ?string  $tone  Background color (hex) for a value, e.g. a green "Lunas"
     */
    public function __construct(
        public readonly string $label,
        public readonly string $type = 'text',
        public readonly float $width = 16,
        public readonly bool $wrap = false,
        public readonly ?Closure $tone = null,
        public readonly bool $summed = false,
    ) {}

    public static function text(string $label, float $width = 18, bool $wrap = false): self
    {
        return new self($label, 'text', $width, $wrap);
    }

    /** Text shown as a colored label; `$tones` maps a value to its color name (see ExcelReport::TONES). */
    public static function status(string $label, array $tones, float $width = 16): self
    {
        return new self($label, 'text', $width, tone: fn ($value) => ExcelReport::TONES[$tones[$value] ?? ''] ?? null);
    }

    public static function number(string $label, float $width = 12, bool $summed = true): self
    {
        return new self($label, 'number', $width, summed: $summed);
    }

    public static function decimal(string $label, float $width = 12, bool $summed = false): self
    {
        return new self($label, 'decimal', $width, summed: $summed);
    }

    public static function rupiah(string $label, float $width = 18, bool $summed = true): self
    {
        return new self($label, 'rupiah', $width, summed: $summed);
    }

    public static function hours(string $label, float $width = 12, bool $summed = true): self
    {
        return new self($label, 'hours', $width, summed: $summed);
    }

    public static function date(string $label, float $width = 14): self
    {
        return new self($label, 'date', $width);
    }

    public static function datetime(string $label, float $width = 18): self
    {
        return new self($label, 'datetime', $width);
    }

    public static function time(string $label, float $width = 9): self
    {
        return new self($label, 'time', $width);
    }
}
