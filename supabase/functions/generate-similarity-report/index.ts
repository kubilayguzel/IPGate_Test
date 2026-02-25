// supabase/functions/generate-similarity-report/index.ts

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageBreak, ImageRun, BorderStyle } from "https://esm.sh/docx@8.5.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- TASARIM VE RENK PALETİ (Eski Firebase Tasarımı) ---
const FONT_FAMILY = "Montserrat";
const GLOBAL_FONT_SIZE = 18; // 9 Punto

const COLORS = {
    CLIENT_HEADER: "1E40AF",    // Müvekkil (Safir Mavi)
    SIMILAR_HEADER: "64748B",   // Benzer (Platin Gri)
    TEXT_DARK: "1E293B",        // Genel Metin
    NICE_BG: "F1F5F9",          // Nice Sınıf Arka Plan
    BORDER_LIGHT: "E2E8F0",     // Kenarlıklar
    DEADLINE_BG: "DBEAFE",      // Alt Panel Arka Plan (Açık Mavi)
    DEADLINE_TEXT: "1E40AF",    // Koyu Mavi Yazı
    EXPERT_BG: "F8FAFC",        // Uzman Görüşü Arka Plan
    EXPERT_BORDER: "1E40AF"     // Uzman Görüşü Kenarlık
};

function isWeekend(date: Date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

// Görsel İndirici
async function downloadImageAsBuffer(imagePath: string, supabase: any): Promise<ArrayBuffer | null> {
    if (!imagePath) return null;
    try {
        if (imagePath.startsWith('http')) {
            const resp = await fetch(imagePath);
            return resp.ok ? await resp.arrayBuffer() : null;
        }
        
        const { data, error } = await supabase.storage.from('brand_images').download(imagePath);
        if (error) return null;
        return await data.arrayBuffer();
    } catch (e) {
        return null;
    }
}

// DOCX Karşılaştırma Sayfası Oluşturucu (ÖZEL TASARIM)
async function createComparisonPage(group: any, supabase: any) {
    const similarMark = group.similarMark || {};
    const monitoredMarks = group.monitoredMarks || [];
    const monitoredMark = monitoredMarks.length > 0 ? monitoredMarks[0] : {};

    const elements = [];
    const tableRows = [];

    // İtiraz Son Tarihi Hesaplama
    let objectionDeadline = "-";
    try {
        const bulletinDateStr = similarMark.bulletinDate || similarMark.applicationDate;
        if (bulletinDateStr && typeof bulletinDateStr === 'string') {
            const parts = bulletinDateStr.split(/[./-]/);
            let bulletinDate = null;
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    bulletinDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                } else {
                    bulletinDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                }
            }
            if (bulletinDate && !isNaN(bulletinDate.getTime())) {
                let targetDate = new Date(bulletinDate);
                targetDate.setMonth(targetDate.getMonth() + 2);
                let iter = 0;
                while (isWeekend(targetDate) && iter < 30) {
                    targetDate.setDate(targetDate.getDate() + 1);
                    iter++;
                }
                objectionDeadline = `${String(targetDate.getDate()).padStart(2, '0')}.${String(targetDate.getMonth() + 1).padStart(2, '0')}.${targetDate.getFullYear()}`;
            }
        }
    } catch (e) {}

    let monitoredImageBuffer = await downloadImageAsBuffer(monitoredMark.imagePath || monitoredMark.brandImageUrl, supabase);
    let similarImageBuffer = await downloadImageAsBuffer(similarMark.imagePath || similarMark.brandImageUrl, supabase);

    // ============ 1. BAŞLIK SATIRI ============
    tableRows.push(
        new TableRow({
            height: { value: 400, rule: "atLeast" },
            children: [
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: "MÜVEKKİL MARKASI", bold: true, size: GLOBAL_FONT_SIZE, color: "FFFFFF", font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { before: 100, after: 50 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: "(İZLENEN)", size: 14, color: "FFFFFF", italics: true, font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { after: 100 }
                        })
                    ],
                    shading: { fill: COLORS.CLIENT_HEADER }, verticalAlign: "center",
                    borders: { right: { style: BorderStyle.SINGLE, size: 6, color: "FFFFFF" } }
                }),
                new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: "BENZER MARKA", bold: true, size: GLOBAL_FONT_SIZE, color: "FFFFFF", font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { before: 100, after: 50 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: "(BÜLTEN)", size: 14, color: "FFFFFF", italics: true, font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { after: 100 }
                        })
                    ],
                    shading: { fill: COLORS.SIMILAR_HEADER }, verticalAlign: "center"
                })
            ]
        })
    );

    // ============ 2. GÖRSEL ALANLARI ============
    const createVisualCell = (imageBuffer: ArrayBuffer | null) => {
        const content = [];
        if (imageBuffer) {
            try {
                content.push(new Paragraph({
                    children: [new ImageRun({ data: imageBuffer, transformation: { width: 160, height: 160 } })],
                    alignment: AlignmentType.CENTER, spacing: { before: 150, after: 150 }
                }));
            } catch (e) {}
        } else {
            content.push(new Paragraph({
                children: [new TextRun({ text: "(Görsel Yok)", size: GLOBAL_FONT_SIZE, color: "94A3B8", italics: true, font: FONT_FAMILY })],
                alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 }
            }));
        }
        return new TableCell({
            children: content, verticalAlign: "center", shading: { fill: "FFFFFF" },
            borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.BORDER_LIGHT } }
        });
    };

    tableRows.push(new TableRow({ children: [createVisualCell(monitoredImageBuffer), createVisualCell(similarImageBuffer)] }));

    // ============ 3. VERİ SATIRLARI ============
    const createInfoRow = (label: string, val1: string, val2: string, bgColor = "FFFFFF") => {
        return new TableRow({
            children: [
                new TableCell({
                    children: [
                        new Paragraph({ children: [new TextRun({ text: label, bold: true, size: GLOBAL_FONT_SIZE, color: COLORS.SIMILAR_HEADER, font: FONT_FAMILY })], spacing: { before: 80, after: 40 } }),
                        new Paragraph({ children: [new TextRun({ text: val1 || "-", size: GLOBAL_FONT_SIZE, color: COLORS.TEXT_DARK, font: FONT_FAMILY })], spacing: { after: 80 } })
                    ],
                    shading: { fill: bgColor }, margins: { left: 120 }, verticalAlign: "center",
                    borders: { right: { style: BorderStyle.SINGLE, size: 2, color: COLORS.BORDER_LIGHT } }
                }),
                new TableCell({
                    children: [
                        new Paragraph({ children: [new TextRun({ text: label, bold: true, size: GLOBAL_FONT_SIZE, color: COLORS.SIMILAR_HEADER, font: FONT_FAMILY })], spacing: { before: 80, after: 40 } }),
                        new Paragraph({ children: [new TextRun({ text: val2 || "-", size: GLOBAL_FONT_SIZE, color: COLORS.TEXT_DARK, font: FONT_FAMILY })], spacing: { after: 80 } })
                    ],
                    shading: { fill: bgColor }, margins: { left: 120 }, verticalAlign: "center"
                })
            ]
        });
    };

    const formatNiceClasses = (classes: any) => {
        if (!classes || classes.length === 0) return "-";
        const classArray = Array.isArray(classes) ? classes : String(classes).split(',').map(s => s.trim());
        return classArray.map((c:string) => `[${c}]`).join(" ");
    };

    tableRows.push(createInfoRow("Nice Sınıfları", formatNiceClasses(monitoredMark.niceClasses), formatNiceClasses(similarMark.niceClasses), COLORS.NICE_BG));
    tableRows.push(createInfoRow("Başvuru No", monitoredMark.applicationNo, similarMark.applicationNo));
    tableRows.push(createInfoRow("Başvuru Tarihi", monitoredMark.applicationDate, similarMark.applicationDate, "FAFAFA"));
    tableRows.push(createInfoRow("Sahip", monitoredMark.ownerName, similarMark.ownerName));

    // ============ 4. SON TARİH VE BAŞARI ŞANSI ============
    const successChance = similarMark.bs || "";
    tableRows.push(
        new TableRow({
            height: { value: 600, rule: "atLeast" },
            children: [
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: "İTİRAZ İÇİN SON TARİH", size: GLOBAL_FONT_SIZE, color: COLORS.DEADLINE_TEXT, font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: objectionDeadline, bold: true, size: GLOBAL_FONT_SIZE, color: COLORS.DEADLINE_TEXT, font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { after: 120 }
                        })
                    ],
                    shading: { fill: COLORS.DEADLINE_BG }, verticalAlign: "center",
                    borders: { top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.CLIENT_HEADER }, right: { style: BorderStyle.SINGLE, size: 4, color: "FFFFFF" } }
                }),
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: "İTİRAZ BAŞARI ŞANSI", size: GLOBAL_FONT_SIZE, color: COLORS.DEADLINE_TEXT, font: FONT_FAMILY })],
                            alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: successChance ? (successChance.includes('%') ? successChance : `%${successChance}`) : "-",
                                    bold: true, size: GLOBAL_FONT_SIZE, color: COLORS.DEADLINE_TEXT, font: FONT_FAMILY
                                })
                            ],
                            alignment: AlignmentType.CENTER, spacing: { after: 120 }
                        })
                    ],
                    shading: { fill: COLORS.DEADLINE_BG }, verticalAlign: "center",
                    borders: { top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.SIMILAR_HEADER } }
                })
            ]
        })
    );

    const comparisonTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.SIMILAR_HEADER },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.SIMILAR_HEADER },
            left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.SIMILAR_HEADER },
            right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.SIMILAR_HEADER },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLORS.BORDER_LIGHT },
            insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLORS.BORDER_LIGHT }
        },
        rows: tableRows
    });

    elements.push(comparisonTable);

    // ============ 5. UZMAN GÖRÜŞÜ KUTUSU ============
    if (similarMark.note && String(similarMark.note).trim() !== "") {
        elements.push(new Paragraph({ text: "", spacing: { after: 150 } }));
        let logoBuffer = await downloadImageAsBuffer('https://ip-manager-production-aab4b.web.app/evreka-logo.png', supabase);

        const noteTableRows = [
            new TableRow({
                children: [
                    new TableCell({
                        children: [
                            ...(logoBuffer ? [new Paragraph({ children: [new ImageRun({ data: logoBuffer, transformation: { width: 100, height: 50 } })], alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 } })] : []),
                            new Paragraph({ children: [new TextRun({ text: "UZMAN DEĞERLENDİRMESİ", bold: true, size: GLOBAL_FONT_SIZE, color: COLORS.EXPERT_BORDER, font: FONT_FAMILY })], alignment: AlignmentType.CENTER, spacing: { before: logoBuffer ? 0 : 120, after: 120 } })
                        ],
                        shading: { fill: "FFFFFF" }, verticalAlign: "center",
                        borders: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.EXPERT_BORDER } }
                    })
                ]
            }),
            new TableRow({
                children: [
                    new TableCell({
                        children: [
                            new Paragraph({ children: [new TextRun({ text: String(similarMark.note).trim(), size: GLOBAL_FONT_SIZE, color: COLORS.TEXT_DARK, font: FONT_FAMILY })], alignment: AlignmentType.LEFT, spacing: { before: 100, after: 100 } })
                        ],
                        shading: { fill: COLORS.EXPERT_BG }, margins: { left: 150, right: 150, top: 100, bottom: 100 }, verticalAlign: "center"
                    })
                ]
            })
        ];

        const noteTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: noteTableRows,
            borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.EXPERT_BORDER },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.EXPERT_BORDER },
                left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.EXPERT_BORDER },
                right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.EXPERT_BORDER }
            }
        });
        elements.push(noteTable);
    }

    elements.push(new Paragraph({ text: "", spacing: { after: 400 } }));

    return elements;
}

// Ana Fonksiyon Yönlendirici
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { results, bulletinNo } = await req.json();

        if (!results || !Array.isArray(results)) throw new Error("Geçersiz veri formatı");

        // Markaları Müvekkillere Göre Grupla
        const owners: Record<string, any[]> = {};
        results.forEach((m) => {
            const ownerName = m.monitoredMark?.ownerName || "Bilinmeyen_Sahip";
            if (!owners[ownerName]) owners[ownerName] = [];
            owners[ownerName].push(m);
        });

        const zip = new JSZip();

        // Her Müvekkil İçin Ayrı Word (DOCX) Dosyası Oluştur
        for (const [ownerNameKey, matches] of Object.entries(owners)) {
            const grouped: Record<string, any> = {};
            matches.forEach((m) => {
                const key = m.similarMark?.applicationNo || 'unknown';
                if (!grouped[key]) grouped[key] = { similarMark: m.similarMark, monitoredMarks: [] };
                grouped[key].monitoredMarks.push(m.monitoredMark);
            });

            const reportContent: any[] = [];
            let i = 0;
            for (const group of Object.values(grouped)) {
                if (i > 0) reportContent.push(new Paragraph({ children: [new PageBreak()] }));
                const pageElements = await createComparisonPage(group, supabase);
                reportContent.push(...pageElements);
                i++;
            }

            const doc = new Document({ sections: [{ children: reportContent }] });
            const docBuffer = await Packer.toBuffer(doc);
            
            // 🔥 WINDOWS HATASI DÜZELTMESİ (Dosya adını kısalttık)
            const safeDocName = ownerNameKey.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 25);
            const fileName = `${safeDocName}_Rapor.docx`;
            
            zip.file(fileName, docBuffer);

            // Supabase Storage'a Yedekle ve Taslak Mail Oluştur
            const targetClientId = matches[0]?.monitoredMark?.clientId;
            if (targetClientId && bulletinNo) {
                const storagePath = `bulletin_reports/${bulletinNo}/${targetClientId}/${fileName}`;
                
                await supabase.storage.from('brand_images').upload(storagePath, docBuffer, {
                    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    upsert: true
                });

                const { data: pUrlData } = supabase.storage.from('brand_images').getPublicUrl(storagePath);

                await supabase.from('mail_notifications').insert({
                    client_id: targetClientId,
                    subject: `${bulletinNo} Sayılı Bülten İzleme Raporu`,
                    body: `<p>Sayın İlgili,</p><p>${bulletinNo} sayılı bülten marka izleme raporunuz ekte sunulmuştur.</p>`,
                    status: 'awaiting_client_approval',
                    mode: 'draft',
                    is_draft: true,
                    source: 'bulletin_watch_system',
                    files: [{ fileName, storagePath, url: pUrlData.publicUrl }]
                });
            }
        }

        const zipBase64 = await zip.generateAsync({ type: "base64" });

        return new Response(JSON.stringify({ success: true, file: zipBase64 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error("Rapor Hatası:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});