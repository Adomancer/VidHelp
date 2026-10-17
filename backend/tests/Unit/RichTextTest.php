<?php

namespace Tests\Unit;

use App\Services\RichText;
use PHPUnit\Framework\TestCase;

class RichTextTest extends TestCase
{
    public function test_wa_text_becomes_formatted_html(): void
    {
        $html = RichText::normalize("*PROMO 11.11*\n_Berlaku 11-13 Nov_ ~Rp 150.000~\n\n- Serum 5X Rp 129.000\n- Toner\n1. Satu\n2. Dua\n\nKatalog https://shop.id/a_b_c_ snake_case_word");

        $this->assertStringContainsString('<p><strong>PROMO 11.11</strong><br /><em>Berlaku 11-13 Nov</em> <s>Rp 150.000</s></p>', $html);
        $this->assertStringContainsString('<ul><li>Serum 5X Rp 129.000</li><li>Toner</li></ul><ol><li>Satu</li><li>Dua</li></ol>', $html);
        // Markers inside links and words are left alone
        $this->assertStringContainsString('href="https://shop.id/a_b_c_"', $html);
        $this->assertStringContainsString('snake_case_word', $html);
    }

    public function test_plain_text_is_escaped(): void
    {
        $this->assertSame('<p>harga &lt; Rp 100.000 &amp; gratis ongkir</p>', RichText::normalize('harga < Rp 100.000 & gratis ongkir'));
    }

    public function test_pasted_html_keeps_formatting_but_not_scripts_or_styles(): void
    {
        $html = RichText::normalize('<h1 style="font-size:40px">Judul</h1><p onclick="x()">Hai <script>alert(1)</script><a href="javascript:alert(1)">x</a> <a href="https://a.com">a</a></p>');

        $this->assertStringContainsString('<h1>Judul</h1>', $html);
        $this->assertStringNotContainsString('script', $html);
        $this->assertStringNotContainsString('onclick', $html);
        $this->assertStringNotContainsString('style', $html);
        $this->assertStringNotContainsString('javascript', $html);
        $this->assertStringContainsString('<a href="https://a.com" target="_blank"', $html);
    }

    public function test_empty_text_is_null(): void
    {
        $this->assertNull(RichText::normalize(null));
        $this->assertNull(RichText::normalize('   '));
        $this->assertNull(RichText::normalize('<p></p><p><br></p>'));
    }
}
