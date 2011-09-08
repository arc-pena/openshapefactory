// AIS_Text.h: interface for the AIS_Text class.
//
//////////////////////////////////////////////////////////////////////

#if !defined(AFX_AIS_Text_H__A9B277C4_A69E_11D1_8DA4_0800369C8A03__INCLUDED_)
#define AFX_AIS_Text_H__A9B277C4_A69E_11D1_8DA4_0800369C8A03__INCLUDED_

#if _MSC_VER >= 1000
#pragma once
#endif // _MSC_VER >= 1000

#include <Standard_Macro.hxx>
#include <Standard_DefineHandle.hxx>

#include <TCollection_AsciiString.hxx>
#include <Aspect_TypeOfText.hxx>
#include <Standard_Real.hxx>
#include <Standard_Integer.hxx>
#include <Quantity_Factor.hxx>
#include <Quantity_PlaneAngle.hxx>
#include <Handle_PrsMgr_PresentationManager2d.hxx>
#include <Handle_Graphic2d_GraphicObject.hxx>
#include <Handle_SelectMgr_Selection.hxx>
#include <Standard_OStream.hxx>
#include <Standard_IStream.hxx>
#include <Standard_CString.hxx>
#include <SelectMgr_SelectableObject.hxx>
#include <Graphic2d_Text.hxx>
#include <AIS_InteractiveObject.hxx>
#include <Graphic2d_PolylineMarker.hxx>
#include <Graphic3d_Group.hxx>
//#include <Graphic2d_Group.hxx>
#include <Graphic2d_Array1OfVertex.hxx>
#include <Graphic3d_Array1OfVertex.hxx>



class TCollection_AsciiString;
class PrsMgr_PresentationManager2d;
class Graphic2d_GraphicObject;
class SelectMgr_Selection;

DEFINE_STANDARD_HANDLE(AIS_Text,AIS_InteractiveObject)
class AIS_Text : public AIS_InteractiveObject  
{
public:
	AIS_Text();

    AIS_Text           (const TCollection_AsciiString& aText,
                             const Standard_Real            anX         = 0   ,
                             const Standard_Real            anY         = 0   ,
                             const Standard_Real            aZ          = 0   ,
                             const Aspect_TypeOfText        aType       = Aspect_TOT_SOLID,
                             const Quantity_PlaneAngle      anAngle     = 0.0 ,
                             const Standard_Real            aSlant      = 0.0 ,
                             const Standard_Integer         aColorIndex = 1   ,
                             const Standard_Integer         aFontIndex  = 1   ,
                             const Quantity_Factor          aScale      = 0.1   );
    AIS_Text
                            (const TCollection_AsciiString& aText, 
                             gp_Pnt&                        aPoint,
                             const Aspect_TypeOfText        aType       = Aspect_TOT_SOLID,
                             const Quantity_PlaneAngle      anAngle     = 0.0 ,
                             const Standard_Real            aSlant      = 0.0 ,
                             const Standard_Integer         aColorIndex = 1   ,
                             const Standard_Integer         aFontIndex  = 3   ,
                             const Quantity_Factor          aScale      = 0.1   );

	virtual ~AIS_Text();

inline   Standard_Integer        NbPossibleSelection() const;
inline   TCollection_AsciiString GetText() const;
inline   void                    SetText(const TCollection_AsciiString& atext) ;
inline   void                    GetCoord(Standard_Real& X, Standard_Real& Y, Standard_Real& Z) const ;
inline   void                    SetCoord(const Standard_Real X, const Standard_Real Y, const Standard_Real Z=0);
inline   Aspect_TypeOfText       GetTypeOfText() const;
inline   void                    SetTypeOfText(const Aspect_TypeOfText aNewTypeOfText) ;
inline   Standard_Real           GetAngle() const;
inline   void                    SetAngle(const Standard_Real aNewAngle) ;
inline   Standard_Real           GetSlant() const;
inline   void                    SetSlant(const Standard_Real aNewSlant) ;
inline   Standard_Integer        GetColorIndex() const;
inline   void                    SetColorIndex(const Standard_Integer aNewColorIndex) ;
inline   Standard_Integer        GetFontIndex() const;
inline   void                    SetFontIndex(const Standard_Integer aNewFontIndex) ;
inline   Quantity_Factor         GetScale() const;
inline   void                    SetScale  (const Quantity_Factor aNewScale) ;


DEFINE_STANDARD_RTTI(AIS_Text)


protected:

 // Methods PROTECTED
 // 


 // Fields PROTECTED
 //


private: 

 // Methods PRIVATE
 // 

void Compute          (const Handle(PrsMgr_PresentationManager3d)& aPresentationManager,
                       const Handle(Prs3d_Presentation)& aPresentation,
                       const Standard_Integer aMode);
void Compute          (const Handle(Prs3d_Projector)& aProjector,
                       const Handle(Prs3d_Presentation)& aPresentation);
void Compute          (const Handle(PrsMgr_PresentationManager2d)& aPresentationManager,
                       const Handle(Graphic2d_GraphicObject)& aGrObj,
                       const Standard_Integer unMode = 0) ;
void ComputeSelection (const Handle(SelectMgr_Selection)& aSelection,
                       const Standard_Integer unMode) ;


 // Fields PRIVATE
 //
TCollection_AsciiString MyText       ; 
Standard_Real           MyX          ;
Standard_Real           MyY          ;
Standard_Real           MyZ          ;
Aspect_TypeOfText       MyTypeOfText ;
Standard_Real           MyAngle      ;
Standard_Real           MySlant      ;
Standard_Integer        MyColorIndex ;
Standard_Integer        MyFontIndex  ;
Quantity_Factor         MyScale      ;
Standard_Real           MyWidth      ;
Standard_Real           MyHeight     ;
Handle(Graphic2d_Text)          mytext3d     ;


};

 inline Standard_Integer AIS_Text::NbPossibleSelection() const 
{ return 1; }

inline TCollection_AsciiString AIS_Text::GetText() const 
{  return MyText ; }

inline void AIS_Text::SetText(const TCollection_AsciiString& atext)
{  MyText = atext; }

inline void AIS_Text::GetCoord(Standard_Real& X, Standard_Real& Y, Standard_Real& Z) const 
{  X = MyX;  Y = MyY; Z = MyZ;}

inline void AIS_Text::SetCoord(const Standard_Real X, const Standard_Real Y, const Standard_Real Z)
{  MyX = X ;  MyY = Y ;  MyZ = Z ;}

inline Aspect_TypeOfText AIS_Text::GetTypeOfText() const 
{  return MyTypeOfText; }

inline void AIS_Text::SetTypeOfText(const Aspect_TypeOfText aNewTypeOfText)
{  MyTypeOfText = aNewTypeOfText; }

inline Standard_Real AIS_Text::GetAngle() const 
{  return MyAngle; }

inline void AIS_Text::SetAngle(const Standard_Real aNewAngle)
{  MyAngle = aNewAngle; }

inline Standard_Real AIS_Text::GetSlant() const 
{  return MySlant; }

inline void AIS_Text::SetSlant(const Standard_Real aNewSlant)
{  MySlant = aNewSlant; }

inline Standard_Integer AIS_Text::GetColorIndex() const 
{  return MyColorIndex; }

inline void AIS_Text::SetColorIndex(const Standard_Integer aNewColorIndex)
{  MyColorIndex = aNewColorIndex; }

inline Standard_Integer AIS_Text::GetFontIndex() const 
{ return MyFontIndex; }

inline void AIS_Text::SetFontIndex(const Standard_Integer aNewFontIndex)
{  MyFontIndex = aNewFontIndex; }

inline Quantity_Factor AIS_Text::GetScale() const 
{  return MyScale; }

inline void AIS_Text::SetScale(const Quantity_Factor aNewScale)
{  MyScale  = aNewScale; }

#endif // !defined(AFX_AIS_Text_H__A9B277C4_A69E_11D1_8DA4_0800369C8A03__INCLUDED_)
