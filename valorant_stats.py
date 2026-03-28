import requests
import json
import sys
import os

# --- KONFİGÜRASYON ---
# HenrikDev API anahtarınız varsa buraya ekleyin, yoksa boş bırakabilirsiniz (Ücretsiz limitlerle çalışır)
# API Key'i bir environment variable olarak da alabiliriz.
API_KEY = os.getenv("HENRIK_VAL_API_KEY", "") 
BASE_URL = "https://api.henrikdev.xyz/valorant"

def get_player_stats(player_id, region="eu"):
    """
    Valorant ID'sini (Name#Tag) alır ve istatistikleri döndürür.
    """
    if "#" not in player_id:
        return {"error": "Hata: Lütfen 'KullanıcıAdı#Tag' formatında girin. Örn: Player#1234"}

    try:
        name, tag = player_id.split("#")
    except ValueError:
        return {"error": "Geçersiz format. Lütfen 'Name#Tag' şeklinde girin."}

    headers = {
        "User-Agent": "StarHUB Valorant Script",
        "accept": "application/json"
    }
    if API_KEY:
        headers["Authorization"] = API_KEY

    result_data = {
        "status": "success",
        "player": f"{name}#{tag}",
        "rank": {},
        "last_3_matches": []
    }

    try:
        # 1. MMR Bilgisi (Current Rank & RR)
        # HenrikDev v2 MMR endpoint'i daha detaylıdır.
        mmr_url = f"{BASE_URL}/v2/mmr/{region}/{name}/{tag}"
        mmr_resp = requests.get(mmr_url, headers=headers, timeout=10)
        
        if mmr_resp.status_code == 404:
            return {"error": "Profil bulunamadı veya Gizli (Private)."}
        elif mmr_resp.status_code == 403:
            return {"error": "Erişim engellendi. API anahtarı gerekebilir veya profil gizli."}
        elif mmr_resp.status_code != 200:
            return {"error": f"API Hatası (MMR): {mmr_resp.status_code}"}

        mmr_json = mmr_resp.json()
        mmr_data = mmr_json.get("data", {})
        
        result_data["rank"] = {
            "title": mmr_data.get("currenttierpatched", "Unranked"),
            "rr": f"{mmr_data.get('ranking_in_tier', 0)} RR",
            "images": mmr_data.get("images", {})
        }

        # 2. Son Maçlar (Matches v3)
        # 'matches' altındaki 'data' listesini alıyoruz, size=3 ile son 3 maçı çekiyoruz.
        matches_url = f"{BASE_URL}/v3/matches/{region}/{name}/{tag}?size=3"
        matches_resp = requests.get(matches_url, headers=headers, timeout=10)
        
        if matches_resp.status_code == 200:
            matches_json = matches_resp.json()
            matches_list = matches_json.get("data", [])
            
            for match in matches_list:
                meta = match.get("metadata", {})
                players = match.get("players", {}).get("all_players", [])
                
                # Bizim oyuncuyu bul (Case-insensitive check)
                me = next((p for p in players if p['name'].lower() == name.lower() and p['tag'].lower() == tag.lower()), None)
                
                if me:
                    team_side = me.get("team", "").lower()
                    team_info = match.get("teams", {}).get(team_side, {})
                    
                    # Maç Sonucu
                    is_winner = team_info.get("has_won", False)
                    match_result = "Win" if is_winner else "Loss"
                    
                    # İstatistikler
                    stats = me.get("stats", {})
                    k = stats.get("kills", 0)
                    d = stats.get("deaths", 0)
                    a = stats.get("assists", 0)
                    
                    # HS Oranı Hesaplama
                    shots = stats.get("headshots", 0) + stats.get("bodyshots", 0) + stats.get("legshots", 0)
                    hs_rate = round((stats.get("headshots", 0) / shots * 100), 1) if shots > 0 else 0

                    result_data["last_3_matches"].append({
                        "map": meta.get("map", "Unknown"),
                        "agent": me.get("character", "Unknown"),
                        "result": match_result,
                        "kda": f"{k}/{d}/{a}",
                        "hs_percent": f"%{hs_rate}"
                    })
        else:
            # Maçlar çekilemese de rank verisini koruyalım
            result_data["match_error"] = f"Maç verileri çekilemedi (Hata: {matches_resp.status_code})"

        return result_data

    except requests.exceptions.RequestException as e:
        return {"error": f"Bağlantı hatası: {str(e)}"}
    except Exception as e:
        return {"error": f"Bir hata oluştu: {str(e)}"}

def print_banner():
    print("=" * 50)
    print("      🌟 STARHUB VALORANT STATS TRACKER 🌟      ")
    print("=" * 50)

def main():
    print_banner()
    
    # Kullanıcıdan giriş alma
    player_id = input("\n👉 Oyuncu ID (Örn: Name#1234): ").strip()
    
    if not player_id:
        print("\n❌ ID girmediniz. Lütfen tekrar deneyin.")
        return

    print("\n🔍 Veriler çekiliyor, lütfen bekleyin...")
    
    # Varsayılan olarak EU bölgesini kullanıyoruz
    stats = get_player_stats(player_id, region="eu")

    if "error" in stats:
        print(f"\n❌ HATA: {stats['error']}")
    else:
        # JSON Çıktısı (Ekrana şık bir şekilde yazdırıyoruz)
        print("\n" + "🏁 GENEL DURUM".center(50, "-"))
        print(f"👤 Oyuncu     : {stats['player']}")
        print(f"📊 Mevcut Rank : {stats['rank']['title']} ({stats['rank']['rr']})")
        
        print("\n" + "⚔️ SON 3 MAÇ".center(50, "-"))
        if not stats["last_3_matches"]:
            print("❗ Maç verisi bulunamadı.")
        else:
            for i, match in enumerate(stats["last_3_matches"], 1):
                icon = "✅ Kazanıldı" if match['result'] == "Win" else "❌ Kaybedildi"
                print(f" {i}. Maç: {icon}")
                print(f"    🗺️ Harita: {match['map']} | 👤 Ajan: {match['agent']}")
                print(f"    🎯 KDA: {match['kda']} | 🎯 HS: {match['hs_percent']}")
                print("-" * 30)
        
        # İsteğe bağlı: Ham JSON verisini de görmek isterseniz
        # print("\n[JSON ÇIKTISI]:")
        # print(json.dumps(stats, indent=4, ensure_ascii=False))

    print("\n" + "=" * 50)
    print("StarHUB iyi oyunlar diler!")

if __name__ == "__main__":
    main()
