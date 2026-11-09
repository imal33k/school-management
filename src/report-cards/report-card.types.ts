// Everything a report card shows, in one plain object.
// The JSON endpoint returns it and the PDF is drawn from it.

export interface ReportCardView {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  school: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
  };
  student: {
    id: string;
    firstName: string;
    lastName: string;
    admissionNumber: string | null;
  };
  class: { id: string; name: string };
  term: { name: string };
  session: { name: string };
  examination: { id: string; name: string };
  components: { id: string; name: string; maxScore: number; isExam: boolean }[];
  subjects: {
    subjectId: string;
    subject: string;
    scores: Record<string, number>;
    totalScore: number;
    maxScore: number;
    grade: string | null;
    remark: string | null;
    position: number | null; // position in this subject within the class
    outOf: number; // how many students have a result in this subject
  }[];
  summary: {
    totalScore: number;
    average: number;
    position: number | null;
    classSize: number;
    subjectCount: number;
    overallGrade: string | null;
  };
  attendance: {
    daysOpened: number;
    present: number; // present + late
    absent: number;
    excused: number;
  };
  teacherRemark: string | null;
  principalRemark: string | null;
  gradeKey: { grade: string; minScore: number; remark: string | null }[];
}
