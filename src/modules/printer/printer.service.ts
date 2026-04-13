import { Injectable } from '@nestjs/common';

import pdfMake from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';

const fonts = {
  Roboto: {
    normal: 'fonts/Roboto-Regular.ttf',
    bold: 'fonts/Roboto-Medium.ttf',
    italics: 'fonts/Roboto-Italic.ttf',
    bolditalics: 'fonts/Roboto-MediumItalic.ttf',
  },
};

pdfMake.addFonts(fonts);

@Injectable()
export class PrinterService {
  async createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
    const pdf = pdfMake.createPdf(docDefinition);
    const buffer = await pdf.getBuffer();
    return buffer;
  }
}
