#!/usr/bin/env python3
"""
Ferramenta de Prospecção Comercial de Anunciantes para Televisão Broadcast
Região: Vale do Paraíba, Litoral Norte e Serra da Mantiqueira - SP.

Uso interativo (menu guiado):
    python scripts/prospectar_vale.py

Uso direto via linha de comando:
    python scripts/prospectar_vale.py --cidade sjc --nicho automotivo --depth 3
    python scripts/prospectar_vale.py --cidade taubate --query "concessionarias" --socials
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(BASE_DIR, "config")
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")
OUTPUT_DIR = os.path.join(BASE_DIR, "leads_vale")


def carregar_json(caminho):
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Erro ao carregar {caminho}: {e}", file=sys.stderr)
        return None


def banner():
    print("=" * 72)
    print(" 📺  PROSPECÇÃO DE ANUNCIANTES - TV BROADCAST (VALE DO PARAÍBA - SP)")
    print("     Geração de Leads B2B para o Departamento Comercial")
    print("=" * 72)


def menu_interativo(cidades_data, nichos_data):
    banner()
    cidades = cidades_data.get("cidades", [])
    categorias = nichos_data.get("categorias", [])

    print("\n📍 SELECIONE A CIDADE / PRAÇA:")
    for idx, c in enumerate(cidades, 1):
        print(f"  [{idx:2d}] {c['nome']} ({c['polo']})")
    print("  [ T] TODAS as 3 maiores (São José dos Campos, Taubaté e Jacareí)")

    escolha_cid = input("\n👉 Escolha o número da cidade [1]: ").strip().lower() or "1"
    
    cidades_selecionadas = []
    if escolha_cid == "t":
        cidades_selecionadas = [c for c in cidades if c["id"] in ("sjc", "taubate", "jacarei")]
    else:
        try:
            num = int(escolha_cid)
            if 1 <= num <= len(cidades):
                cidades_selecionadas = [cidades[num - 1]]
            else:
                cidades_selecionadas = [cidades[0]]
        except ValueError:
            # tenta buscar por nome ou id
            found = [c for c in cidades if escolha_cid in c["id"] or escolha_cid in c["nome"].lower()]
            cidades_selecionadas = found[:1] if found else [cidades[0]]

    print("\n🎯 SELECIONE O NICHO DE ANUNCIANTES:")
    for idx, n in enumerate(categorias, 1):
        print(f"  [{idx}] {n['nome']}")
    print("  [0] Digitar outro termo livremente")

    escolha_nicho = input("\n👉 Escolha o nicho [1]: ").strip() or "1"
    
    keywords = []
    nome_nicho = ""
    if escolha_nicho == "0":
        termo = input("👉 Digite o termo de busca (ex: óticas, móveis, restaurantes): ").strip()
        if not termo:
            termo = "empresas"
        keywords = [termo]
        nome_nicho = termo.replace(" ", "_")
    else:
        try:
            num = int(escolha_nicho)
            if 1 <= num <= len(categorias):
                cat = categorias[num - 1]
                keywords = cat["keywords"]
                nome_nicho = cat["id"]
            else:
                cat = categorias[0]
                keywords = cat["keywords"]
                nome_nicho = cat["id"]
        except ValueError:
            cat = categorias[0]
            keywords = cat["keywords"]
            nome_nicho = cat["id"]

    print("\n⚙️  CONFIGURAÇÕES DE BUSCA:")
    depth_str = input("👉 Profundidade de busca (1 a 10, padrão 3 para ~40-60 leads): ").strip() or "3"
    try:
        depth = max(1, min(10, int(depth_str)))
    except ValueError:
        depth = 3

    socials_resp = input("👉 Extrair redes sociais (Instagram/Facebook) e checar WhatsApp no site? (S/n) [S]: ").strip().lower()
    buscar_socials = socials_resp != "n"

    return cidades_selecionadas, keywords, nome_nicho, depth, buscar_socials


def executar_prospeccao(cidade, keywords, nome_nicho, depth, buscar_socials):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"leads_{cidade['id']}_{nome_nicho}_{timestamp}.csv"
    caminho_saida = os.path.join(OUTPUT_DIR, nome_arquivo)

    print("\n" + "-" * 72)
    print(f"🚀 INICIANDO RASPAGEM: {cidade['nome']} | Nicho: {nome_nicho}")
    print(f"   Destino: {caminho_saida}")
    print("-" * 72)

    # Preparar termos com a cidade inclusa
    query_city = cidade.get("query_city", f"{cidade['nome']}, SP")
    termos_com_cidade = [f"{kw} em {query_city}" for kw in keywords]

    cmd = [
        sys.executable,
        os.path.join(SCRIPTS_DIR, "scrape.py"),
        termos_com_cidade[0],
        cidade["lat"],
        cidade["lon"],
        "--depth", str(depth),
        "--lang", "pt",
        "--out", caminho_saida
    ]

    for extra_kw in termos_com_cidade[1:]:
        cmd.extend(["--keyword", extra_kw])

    if buscar_socials:
        cmd.append("--socials")

    res = subprocess.run(cmd)
    if res.returncode == 0:
        print(f"\n✅ Coleta concluída com sucesso!")
        print(f"📁 Arquivo pronto para o Excel/CRM: {caminho_saida}")
    else:
        print(f"\n⚠️ Ocorreu uma falha na coleta (código {res.returncode}).")


def main():
    parser = argparse.ArgumentParser(description="Prospeccao comercial de TV - Vale do Paraiba")
    parser.add_argument("--cidade", help="ID da cidade (sjc, taubate, jacarei, pinda, guara, etc.)")
    parser.add_argument("--nicho", help="ID do nicho (automotivo, imobiliario, saude, educacao, etc.)")
    parser.add_argument("--query", help="Termo de busca customizado livre")
    parser.add_argument("--depth", type=int, default=3, help="Profundidade da busca (padrao: 3)")
    parser.add_argument("--socials", action="store_true", help="Ativar busca de redes sociais e WhatsApp no site")
    args = parser.parse_args()

    cidades_data = carregar_json(os.path.join(CONFIG_DIR, "vale_paraiba.json")) or {}
    nichos_data = carregar_json(os.path.join(CONFIG_DIR, "nichos_anunciantes_tv.json")) or {}

    cidades = cidades_data.get("cidades", [])
    categorias = nichos_data.get("categorias", [])

    if not args.cidade and not args.query:
        # Modo Interativo
        cidades_sel, keywords, nome_nicho, depth, buscar_socials = menu_interativo(cidades_data, nichos_data)
        for cid in cidades_sel:
            executar_prospeccao(cid, keywords, nome_nicho, depth, buscar_socials)
    else:
        # Modo Linha de comando
        cidade_alvo = None
        cid_busca = (args.cidade or "sjc").lower()
        for c in cidades:
            if c["id"] == cid_busca or cid_busca in c["nome"].lower():
                cidade_alvo = c
                break
        if not cidade_alvo:
            cidade_alvo = cidades[0]

        if args.query:
            keywords = [args.query]
            nome_nicho = args.query.replace(" ", "_")
        elif args.nicho:
            cat_encontrada = next((cat for cat in categorias if cat["id"] == args.nicho.lower()), None)
            if cat_encontrada:
                keywords = cat_encontrada["keywords"]
                nome_nicho = cat_encontrada["id"]
            else:
                keywords = [args.nicho]
                nome_nicho = args.nicho
        else:
            cat = categorias[0]
            keywords = cat["keywords"]
            nome_nicho = cat["id"]

        executar_prospeccao(cidade_alvo, keywords, nome_nicho, args.depth, args.socials)


if __name__ == "__main__":
    main()
