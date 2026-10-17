<?php

namespace App\Services;

use HTMLPurifier;
use HTMLPurifier_Config;

/**
 * Formatted text people paste in (product knowledge): stored as a small, safe subset of HTML.
 * Plain text, e.g. pasted from WA, is converted first: *bold*, _italic_, ~strike~, "- " and
 * "1. " lists, paragraphs and links.
 */
class RichText
{
    /** The tags (and the one attribute) that survive cleaning; the editor's toolbar makes only these. */
    private const ALLOWED = 'p,br,strong,b,em,i,u,s,h1,h2,h3,ul,ol,li,blockquote,hr,a[href]';

    private static ?HTMLPurifier $purifier = null;

    /** Safe HTML from what was sent (HTML or plain text), or null when there is no text in it. */
    public static function normalize(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $html = trim(self::purifier()->purify(self::isHtml($value) ? $value : self::fromText($value)));

        return trim(html_entity_decode(strip_tags($html)), " \n\r\t\v\0\u{A0}") === '' ? null : $html;
    }

    public static function isHtml(string $value): bool
    {
        return (bool) preg_match('/<(p|br|div|h[1-6]|ul|ol|li|strong|b|em|i|u|s|a|span|blockquote)\b[^>]*>/i', $value);
    }

    /** Plain text (WA formatting) as HTML: blank lines split paragraphs, "- "/"1. " lines make lists. */
    public static function fromText(string $text): string
    {
        $blocks = preg_split('/\n\s*\n/', trim(str_replace(["\r\n", "\r"], "\n", $text)));
        $html = '';

        foreach ($blocks as $block) {
            $list = null;
            $lines = [];
            foreach (explode("\n", $block) as $line) {
                $type = match (true) {
                    (bool) preg_match('/^\s*[-•*]\s+/u', $line) => 'ul',
                    (bool) preg_match('/^\s*\d+[.)]\s+/', $line) => 'ol',
                    default => null,
                };
                if ($type !== $list) {
                    $html .= self::flush($list, $lines);
                    $list = $type;
                    $lines = [];
                }
                $lines[] = $type ? preg_replace('/^\s*(?:[-•*]|\d+[.)])\s+/u', '', $line) : $line;
            }
            $html .= self::flush($list, $lines);
        }

        return $html;
    }

    /** @param  list<string>  $lines */
    private static function flush(?string $list, array $lines): string
    {
        if ($lines === []) {
            return '';
        }
        $lines = array_map(self::inline(...), $lines);

        return $list
            ? "<{$list}>".implode('', array_map(fn ($line) => "<li>{$line}</li>", $lines))."</{$list}>"
            : '<p>'.implode('<br>', $lines).'</p>';
    }

    /** WA's *bold*, _italic_ and ~strike~ markers, and http(s) links, on one escaped line. */
    private static function inline(string $line): string
    {
        // Odd parts are links, left alone by the markers
        $parts = preg_split('~(https?://\S+)~', $line, -1, PREG_SPLIT_DELIM_CAPTURE);

        return implode('', array_map(function (string $part, int $index) {
            $part = e($part, false);
            if ($index % 2 === 1) {
                return "<a href=\"{$part}\">{$part}</a>";
            }
            foreach (['*' => 'strong', '_' => 'em', '~' => 's'] as $mark => $tag) {
                $m = preg_quote($mark, '/');
                $part = preg_replace("/(?<![\\w{$m}]){$m}(?=\\S)([^{$m}\\n]*?\\S){$m}(?![\\w{$m}])/u", "<{$tag}>$1</{$tag}>", $part);
            }

            return $part;
        }, $parts, array_keys($parts)));
    }

    private static function purifier(): HTMLPurifier
    {
        if (! self::$purifier) {
            $config = HTMLPurifier_Config::createDefault();
            $config->set('HTML.Allowed', self::ALLOWED);
            $config->set('HTML.TargetBlank', true);
            $config->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true, 'tel' => true]);
            $config->set('AutoFormat.RemoveEmpty', true);
            $config->set('Cache.DefinitionImpl', null);
            self::$purifier = new HTMLPurifier($config);
        }

        return self::$purifier;
    }
}
