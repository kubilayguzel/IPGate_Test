import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// TODO: Kendi URL ve Anon Key'inizi buraya girin
const supabaseUrl = 'https://guicrctynauzxhyfpdfe.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1aWNyY3R5bmF1enhoeWZwZGZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDQ3MjcsImV4cCI6MjA4NzI4MDcyN30.Zp1ZoXfsz6y6UcZtOAWlIWY2USjJ8x-0iogtizX0EkQ';

export const supabase = createClient(supabaseUrl, supabaseKey);
console.log('🚀 Supabase Motoru Başarıyla Çalıştı!');

// --- YENİ: SUPABASE AUTH SERVICE ---
export const authService = {
    // Supabase bağlantı durumunu kontrol etmek için
    isSupabaseAvailable: true, 

    async signIn(email, password) {
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });
            if (error) throw error;

            // Şimdilik test amaçlı rolü user atıyoruz. İleride 'users' tablosundan çekeceğiz.
            const userData = { 
                uid: data.user.id, 
                email: data.user.email, 
                displayName: data.user.user_metadata?.display_name || '', 
                role: 'user', 
                isSuperAdmin: false 
            };
            localStorage.setItem('currentUser', JSON.stringify(userData));
            
            return { success: true, user: userData, message: "Giriş başarılı!" };
        } catch (error) {
            console.error("Giriş hatası:", error);
            return { success: false, error: "Hatalı e-posta veya şifre: " + error.message };
        }
    },

    async signUp(email, password, displayName, initialRole = 'belirsiz') {
        try {
            // Supabase'de displayName gibi ekstra veriler 'user_metadata' içine yazılır
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        display_name: displayName,
                        role: initialRole
                    }
                }
            });
            if (error) throw error;
            return { success: true, message: "Kayıt başarılı! E-postanızı doğrulayın." };
        } catch (error) {
            console.error("Kayıt hatası:", error);
            return { success: false, error: error.message };
        }
    },

    async signOut() {
        await supabase.auth.signOut();
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    },

    async resetPassword(email) {
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email);
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    getCurrentUser() {
        const localData = localStorage.getItem('currentUser');
        return localData ? JSON.parse(localData) : null;
    }
};