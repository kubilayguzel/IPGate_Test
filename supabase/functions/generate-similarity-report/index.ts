// Ana Fonksiyon Yönlendirici
serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { results, bulletinNo } = await req.json();

        if (!results || !Array.isArray(results)) throw new Error("Geçersiz veri formatı");

        const owners: Record<string, any[]> = {};
        results.forEach((m) => {
            const ownerName = m.monitoredMark?.ownerName || "Bilinmeyen_Sahip";
            if (!owners[ownerName]) owners[ownerName] = [];
            owners[ownerName].push(m);
        });

        const zip = new JSZip();

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
            
            const safeDocName = ownerNameKey.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 25);
            const fileName = `${safeDocName}_Rapor.docx`;
            
            zip.file(fileName, docBuffer);

            // 🔥 KAPSAM HATASI ÇÖZÜMÜ: objectionDeadline hesaplaması ana bloğa alındı
            let mailObjectionDeadline = "-";
            const bDateStr = matches[0]?.similarMark?.bulletinDate || matches[0]?.similarMark?.applicationDate;
            if (bDateStr && typeof bDateStr === 'string') {
                const parts = bDateStr.split(/[./-]/);
                if (parts.length === 3) {
                    let bDate = parts[0].length === 4 
                        ? new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
                        : new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                    if (!isNaN(bDate.getTime())) {
                        bDate.setMonth(bDate.getMonth() + 2);
                        let iter = 0;
                        while ((bDate.getDay() === 0 || bDate.getDay() === 6) && iter < 30) {
                            bDate.setDate(bDate.getDate() + 1);
                            iter++;
                        }
                        mailObjectionDeadline = `${String(bDate.getDate()).padStart(2, '0')}.${String(bDate.getMonth() + 1).padStart(2, '0')}.${bDate.getFullYear()}`;
                    }
                }
            }

            const targetClientId = matches[0]?.monitoredMark?.clientId || matches[0]?.monitoredMark?.details?.clientId || null;

            if (targetClientId && bulletinNo) {
                const storagePath = `bulletin_reports/${bulletinNo}/${targetClientId}/${fileName}`;
                
                await supabase.storage.from('brand_images').upload(storagePath, docBuffer, {
                    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    upsert: true
                });

                const { data: pUrlData } = supabase.storage.from('brand_images').getPublicUrl(storagePath);

                // 🔥 ŞEMA UYUMLU KAYIT: mail_notifications'da olmayan alanlar "details" JSONB objesi içine kondu.
                await supabase.from('mail_notifications').insert({
                    related_ip_record_id: targetClientId,
                    subject: `${bulletinNo} Sayılı Bülten İzleme Raporu`,
                    body: `<p>Sayın İlgili,</p><p>${bulletinNo} sayılı bülten marka izleme raporunuz ekte sunulmuştur.</p>`,
                    status: 'awaiting_client_approval',
                    files: [{ fileName, storagePath, url: pUrlData.publicUrl }],
                    details: {
                        client_id: targetClientId,
                        applicant_name: ownerNameKey,
                        bulletin_no: String(bulletinNo),
                        objection_deadline: mailObjectionDeadline,
                        mode: 'draft',
                        is_draft: true,
                        notification_type: 'marka',
                        source: 'bulletin_watch_system',
                        task_attachments: [{ name: fileName, storagePath, url: pUrlData.publicUrl }]
                    }
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