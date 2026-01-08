#!/usr/bin/env python3
"""
Create a professional PDF document with Chrome browser tabs information
"""

from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime
import os

# Chrome tabs data from the browser connection
tabs_data = [
    {
        "index": 0,
        "title": "App-Center-ZCP",
        "url": "https://zcp-eng.corp.zoom.us/app/app-center/pipeline-new/detail?workflowId=42a72814-cbe0-4162-a238-743e174d59d0&tab=execution-history&appId=64be15f052304db4f1235ab2"
    },
    {
        "index": 1,
        "title": "Page Summary Testing",
        "url": "https://dg01docs.zoom.us/doc/b8NVD5zjSc6eK0CQX8JDMQ"
    },
    {
        "index": 2,
        "title": "(timeout)",
        "url": ""
    },
    {
        "index": 3,
        "title": "AI Team Task Tracker",
        "url": "https://dg01docs.zoom.us/doc/cpXUnbpKTgWQxE1xmoXPpA"
    },
    {
        "index": 4,
        "title": "Session Viewer - Browser Agent",
        "url": "file:///Users/roland.wang/repos/browser-agent/chat-agent/tools/session-viewer.html"
    },
    {
        "index": 5,
        "title": "Agent Trace Viewer",
        "url": "file:///Users/roland.wang/repos/browser-agent/chat-agent/tools/trace-viewer.html"
    },
    {
        "index": 6,
        "title": "Docs Feature Tags",
        "url": "https://dg01docs.zoom.us/doc/LYPT_PBoT9i-2r3LMzUcew"
    },
    {
        "index": 7,
        "title": "Zoom Docs doc-bridge - Cube",
        "url": "https://cube.zoom.us/dashboards/ff46a5a7-9b6a-4ab2-812b-2faa2a2039d3"
    },
    {
        "index": 8,
        "title": "A new dataset",
        "url": "https://dg01docs.zoom.us/doc/rZM7lOmRTNWR-rXNb5IZtA"
    },
    {
        "index": 9,
        "title": "GitHub - anthropics/skills: Public repository for Agent Skills",
        "url": "https://github.com/anthropics/skills/tree/main"
    },
    {
        "index": 10,
        "title": "Docs 2.0 Reader Case",
        "url": "https://dg01docs.zoom.us/doc/QtaAnaO5SquPvVITorHC0A?from=client"
    },
    {
        "index": 11,
        "title": "chrome://newtab-footer/",
        "url": "chrome://newtab-footer/ [internal]"
    },
    {
        "index": 12,
        "title": "(timeout)",
        "url": ""
    },
    {
        "index": 13,
        "title": "DevTools",
        "url": "devtools://devtools/bundled/devtools_app.html [internal]"
    },
    {
        "index": 14,
        "title": "钓鱼",
        "url": "https://devepdocs.zoomdev.us/doc/XK7D4s6MS3-qvUJ2VX_mBw"
    },
    {
        "index": 15,
        "title": "Cost Saving Tips for Claude Code",
        "url": "https://docs.zoom.us/doc/a4iZLHibTEuBFI_0VV1MGg"
    },
    {
        "index": 16,
        "title": "「Pros Cons 框架」是否合并 Paper 与 Docs 的分析",
        "url": "https://dg01docs.zoom.us/doc/IRpnAn4nS2OQTYtNrM9Bzw"
    },
    {
        "index": 17,
        "title": "Evals - Dataset Design Spec",
        "url": "https://devepdocs.zoomdev.us/doc/2j7B0mmvQAqFdxatDsG9Dg"
    },
    {
        "index": 18,
        "title": "agent how to implement todo manager - Google Search",
        "url": "https://www.google.com/search?q=agent+how+to+implement+todo+manager"
    },
    {
        "index": 19,
        "title": "钓鱼",
        "url": "https://devepdocs.zoomdev.us/doc/XK7D4s6MS3-qvUJ2VX_mBw"
    },
    {
        "index": 20,
        "title": "Zoom Docs doc-bridge - Cube",
        "url": "https://cube.zoom.us/dashboards/ff46a5a7-9b6a-4ab2-812b-2faa2a2039d3"
    },
    {
        "index": 21,
        "title": "Zebra (Global Tracing)",
        "url": "https://linktrace.zoom.us/tracing/#/configuration/discover"
    },
    {
        "index": 22,
        "title": "Requirements",
        "url": "https://dg01docs.zoom.us/doc/PhC9e-z9Q1C5Fm03hUCNQA"
    },
    {
        "index": 23,
        "title": "最近 - Zoom Docs",
        "url": "https://docs.zoom.us/recent"
    },
    {
        "index": 24,
        "title": "GitHub - steveyegge/beads: Beads - A memory upgrade for your coding agent",
        "url": "https://github.com/steveyegge/beads"
    },
    {
        "index": 25,
        "title": "Zoom Docs 2026 Release Cadence",
        "url": "https://dg01docs.zoom.us/doc/nMcSFgF2SXqmhrun8uUjlQ"
    },
    {
        "index": 26,
        "title": "Zoom Video Communications - 登录",
        "url": "https://zoom.okta.com/oauth2/default/v1/authorize"
    },
]

def create_tabs_pdf(output_filename="chrome_tabs_report.pdf"):
    """Create a professional PDF document with browser tabs information"""

    # Register Chinese fonts
    # Try to find system fonts that support Chinese
    chinese_font_paths = [
        '/System/Library/Fonts/PingFang.ttc',  # macOS PingFang
        '/System/Library/Fonts/STHeiti Light.ttc',  # macOS STHeiti
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',  # macOS Arial Unicode
        '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',  # Linux
        'C:\\Windows\\Fonts\\simhei.ttf',  # Windows SimHei
        'C:\\Windows\\Fonts\\msyh.ttc',  # Windows Microsoft YaHei
    ]

    chinese_font_registered = False
    for font_path in chinese_font_paths:
        if os.path.exists(font_path):
            try:
                # Register the font
                if font_path.endswith('.ttc'):
                    # TTC files need special handling
                    pdfmetrics.registerFont(TTFont('ChineseFont', font_path, subfontIndex=0))
                else:
                    pdfmetrics.registerFont(TTFont('ChineseFont', font_path))
                chinese_font_registered = True
                print(f"✓ Registered Chinese font: {font_path}")
                break
            except Exception as e:
                print(f"Failed to register {font_path}: {e}")
                continue

    if not chinese_font_registered:
        print("Warning: No Chinese font found, using fallback (may show squares for Chinese characters)")
        font_name = 'Helvetica'
        font_name_bold = 'Helvetica-Bold'
    else:
        font_name = 'ChineseFont'
        font_name_bold = 'ChineseFont'

    # Create the PDF document
    doc = SimpleDocTemplate(
        output_filename,
        pagesize=letter,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch
    )

    # Container for the 'Flowable' objects
    story = []

    # Define styles
    styles = getSampleStyleSheet()

    # Custom styles with Chinese font support
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a73e8'),
        spaceAfter=12,
        alignment=TA_CENTER,
        fontName=font_name_bold
    )

    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.grey,
        spaceAfter=20,
        alignment=TA_CENTER,
        fontName=font_name
    )

    section_heading_style = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#1a73e8'),
        spaceAfter=10,
        spaceBefore=15,
        fontName=font_name_bold
    )

    tab_title_style = ParagraphStyle(
        'TabTitle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.black,
        spaceAfter=4,
        fontName=font_name_bold
    )

    tab_url_style = ParagraphStyle(
        'TabURL',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#5f6368'),
        spaceAfter=12,
        fontName=font_name,
        wordWrap='CJK'
    )

    # Title
    title = Paragraph("Chrome Browser Tabs Report", title_style)
    story.append(title)

    # Subtitle with timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    subtitle = Paragraph(f"Generated on {timestamp}", subtitle_style)
    story.append(subtitle)

    story.append(Spacer(1, 0.3*inch))

    # Overview section
    overview_heading = Paragraph("Overview", section_heading_style)
    story.append(overview_heading)

    # Summary statistics
    total_tabs = len(tabs_data)
    internal_tabs = len([t for t in tabs_data if '[internal]' in t['url'] or t['url'].startswith('chrome://') or t['url'].startswith('devtools://')])
    regular_tabs = total_tabs - internal_tabs
    empty_tabs = len([t for t in tabs_data if not t['url'] or t['title'] == '(timeout)'])

    summary_data = [
        ['Total Tabs', str(total_tabs)],
        ['Regular Tabs', str(regular_tabs)],
        ['Internal/DevTools Tabs', str(internal_tabs)],
        ['Empty/Timeout Tabs', str(empty_tabs)],
    ]

    summary_table = Table(summary_data, colWidths=[3*inch, 1.5*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8f9fa')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), font_name_bold),
        ('FONTNAME', (1, 0), (-1, -1), font_name),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey)
    ]))

    story.append(summary_table)
    story.append(Spacer(1, 0.4*inch))

    # Tabs list section
    tabs_heading = Paragraph("Detailed Tab List", section_heading_style)
    story.append(tabs_heading)

    # Add each tab
    for tab in tabs_data:
        # Tab number and title
        tab_header = f"Tab {tab['index']}: {tab['title']}"
        story.append(Paragraph(tab_header, tab_title_style))

        # URL
        if tab['url']:
            # Truncate very long URLs for display
            display_url = tab['url']
            if len(display_url) > 100:
                display_url = display_url[:97] + "..."
            story.append(Paragraph(f"<font color='#1a73e8'><u>{display_url}</u></font>", tab_url_style))
        else:
            story.append(Paragraph("<i>(No URL)</i>", tab_url_style))

        story.append(Spacer(1, 0.1*inch))

    # Build PDF
    doc.build(story)
    print(f"✓ PDF created successfully: {output_filename}")

if __name__ == "__main__":
    create_tabs_pdf()
